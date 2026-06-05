// Tests for the Cloudflare Pages Function Discord proxy: pure payload
// builders + webhook routing + retry delivery + the onRequestPost handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  htmlToText, buildPrPayload, buildVsPayload, buildVsConsultPayload,
  buildProjectPayload, parseVsWebhooks, resolveTarget, postToDiscord,
} from './_discord.js';
import { onRequestPost } from './notify.js';

const noSleep = () => Promise.resolve();
const resp = (status, body = '', headers = {}) => ({
  status,
  headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

const ENV = {
  DISCORD_PR_WEBHOOK: 'https://discord/pr',
  DISCORD_PROJECTS_WEBHOOK: 'https://discord/projects',
  DISCORD_VS_WEBHOOKS: JSON.stringify({
    SE: 'https://discord/vs/se',
    'อุปนายกฝ่ายวิชาการ': 'https://discord/vs/academic',
  }),
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('htmlToText', () => {
  it('flattens Quill HTML to Discord text', () => {
    expect(htmlToText('<p>line one</p><p>line two</p>')).toBe('line one\nline two');
    expect(htmlToText('a<br>b')).toBe('a\nb');
    expect(htmlToText('<b>bold</b> <i>x</i>')).toBe('bold x');
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
  });
});

describe('buildPrPayload', () => {
  it('builds fields, image links, and normal (blue) color', () => {
    const p = buildPrPayload({
      ticketId: 'PR-1', content: 'Poster', department: 'media', jobType: 'โปสเตอร์',
      contact: '@x', uploadedUrls: ['u1', 'u2'], deadlineMode: 'Normal',
    });
    expect(p.content).toContain('media');
    expect(p.embeds[0].title).toBe('Poster');
    expect(p.embeds[0].color).toBe(3447003);
    const fileField = p.embeds[0].fields.find((f) => f.name === 'ไฟล์แนบ');
    expect(fileField.value).toContain('ภาพที่ 1');
    expect(fileField.value).toContain('ภาพที่ 2');
    expect(p.flags).toBeUndefined();
  });

  it('rush → red, silent → flags 4096, other-platform fields appended', () => {
    const p = buildPrPayload({
      ticketId: 'PR-2', content: 'X', department: 'd', deadlineMode: 'Rush PR Review',
      silentNotify: true, otherPlatform: ['IG', 'FB'], otherPlatformReason: 'reach',
    });
    expect(p.embeds[0].color).toBe(16711680);
    expect(p.flags).toBe(4096);
    expect(p.embeds[0].fields.some((f) => f.name === 'Other Platform' && f.value === 'IG, FB')).toBe(true);
    expect(p.embeds[0].fields.some((f) => f.name === 'เหตุผลที่ต้องการ PR')).toBe(true);
  });
});

describe('buildVsPayload', () => {
  it('normal ticket: @here mention, red embed, dept in title', () => {
    const p = buildVsPayload({ ticketId: 'VS-1', vsProblem: '<p>broken</p>', department: 'SE' });
    expect(p.content).toContain('@here');
    expect(p.embeds[0].title).toBe('Ticket: VS-1 [SE]');
    expect(p.embeds[0].description).toBe('broken');
    expect(p.embeds[0].color).toBe(15548997);
  });

  it('emergency → brighter red + emergency copy', () => {
    const p = buildVsPayload({ ticketId: 'VS-2', vsProblem: 'x', department: 'SE', isEmergency: true });
    expect(p.content).toContain('ฉุกเฉิน');
    expect(p.embeds[0].color).toBe(16711680);
  });

  it('silent → no mention + flags 4096', () => {
    const p = buildVsPayload({ ticketId: 'VS-3', vsProblem: 'x', department: 'SE', vsSilentNotify: true });
    expect(p.content).not.toContain('@here');
    expect(p.flags).toBe(4096);
  });

  it('non-SE requestedDept adds a routing note; empty problem gets a placeholder', () => {
    const p = buildVsPayload({ ticketId: 'VS-4', vsProblem: '', department: 'SE', requestedDept: 'อุปนายกฝ่ายวิชาการ' });
    expect(p.embeds[0].description).toContain('ไม่มีข้อความ');
    expect(p.embeds[0].description).toContain('อุปนายกฝ่ายวิชาการ');
  });
});

describe('buildVsConsultPayload', () => {
  it('includes role, dept, status, remark', () => {
    const p = buildVsConsultPayload({
      ticketId: 'VS-9', role: 'SE', displayDept: 'วิชาการ', displayStatus: 'กำลังดำเนินการ', remark: 'โอนให้ฝ่าย',
    });
    expect(p.content).toContain('SE');
    expect(p.embeds[0].title).toBe('อัปเดต Ticket: VS-9');
    expect(p.embeds[0].description).toContain('วิชาการ');
    expect(p.embeds[0].description).toContain('โอนให้ฝ่าย');
    expect(p.embeds[0].color).toBe(3447003);
  });
});

describe('buildProjectPayload', () => {
  it('wraps title/description/color/fields into an embed', () => {
    const p = buildProjectPayload({ title: 'หนังสือ', description: 'd', color: 123, fields: [{ name: 'a', value: 'b' }] });
    expect(p.embeds[0]).toMatchObject({ title: 'หนังสือ', description: 'd', color: 123 });
    expect(p.embeds[0].fields).toHaveLength(1);
  });
  it('passes a pre-built payload through unchanged', () => {
    const raw = { content: 'c', embeds: [{ title: 't' }] };
    expect(buildProjectPayload({ payload: raw })).toBe(raw);
  });
});

describe('parseVsWebhooks / resolveTarget', () => {
  it('tolerates malformed JSON (returns {})', () => {
    expect(parseVsWebhooks({ DISCORD_VS_WEBHOOKS: '{bad' })).toEqual({});
    expect(parseVsWebhooks({})).toEqual({});
  });

  it('routes each action to the right webhook', () => {
    expect(resolveTarget('notifyPROnly', { ticketId: 'P' }, ENV).url).toBe('https://discord/pr');
    expect(resolveTarget('notifyProjectDiscord', { title: 't' }, ENV).url).toBe('https://discord/projects');
    expect(resolveTarget('notifyVSOnly', { department: 'อุปนายกฝ่ายวิชาการ' }, ENV).url).toBe('https://discord/vs/academic');
    expect(resolveTarget('notifyVSConsult', { notifyTo: 'SE' }, ENV).url).toBe('https://discord/vs/se');
  });

  it('VS falls back to SE webhook when dept is unmapped', () => {
    expect(resolveTarget('notifyVSOnly', { department: 'ไม่มีฝ่ายนี้' }, ENV).url).toBe('https://discord/vs/se');
  });

  it('unknown action → { error }', () => {
    expect(resolveTarget('bogus', {}, ENV).error).toMatch(/unknown action/);
  });
});

describe('postToDiscord', () => {
  it('returns ok on a 2xx first shot (one attempt)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(204));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r).toEqual({ ok: true, status: 204, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a 429 then succeeds, honouring Retry-After', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(resp(429, 'rate limited', { 'Retry-After': '0.5' }))
      .mockResolvedValueOnce(resp(204));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ ok: true, status: 204, retried: true, attempts: 2, firstStatus: 429 });
  });

  it('does NOT retry a 400 (non-transient) — bails after one attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(400, 'bad payload'));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('bails immediately on a Cloudflare 1015 body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(429, 'error code: 1015'));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();  // no retry after 1015
  });

  it('does not crash when an error response body cannot be read', async () => {
    // resp.text rejects — must NOT be misclassified as a transport throw.
    const badBody = { status: 400, headers: { get: () => null }, text: async () => { throw new Error('stream'); } };
    const fetchImpl = vi.fn().mockResolvedValue(badBody);
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);          // a real 400, not threw:true
    expect(fetchImpl).toHaveBeenCalledOnce();  // 400 is non-transient → no retry
  });

  it('treats a transport throw as transient and exhausts attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('onRequestPost (handler)', () => {
  function req(bodyObj) {
    return { text: async () => JSON.stringify(bodyObj) };
  }
  async function readJson(response) {
    return JSON.parse(await response.text());
  }

  it('400 on an unparseable body', async () => {
    const res = await onRequestPost({ request: { text: async () => 'not json' }, env: ENV });
    expect(res.status).toBe(400);
    expect((await readJson(res)).success).toBe(false);
  });

  it('delivers a PR notify to the PR webhook and returns success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(204));
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequestPost({
      request: req({ action: 'notifyPROnly', ticketId: 'PR-1', content: 'x', department: 'media' }),
      env: ENV,
    });
    const body = await readJson(res);
    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://discord/pr');
    vi.unstubAllGlobals();
  });

  it('routes a VS submit to the dept webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(204));
    vi.stubGlobal('fetch', fetchMock);
    await onRequestPost({
      request: req({ action: 'notifyVSOnly', ticketId: 'VS-1', vsProblem: '<p>x</p>', department: 'อุปนายกฝ่ายวิชาการ' }),
      env: ENV,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://discord/vs/academic');
    vi.unstubAllGlobals();
  });

  it('success:false when no webhook is configured for the action', async () => {
    const res = await onRequestPost({
      request: req({ action: 'notifyPROnly', content: 'x' }),
      env: {},  // no DISCORD_PR_WEBHOOK
    });
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/no webhook/);
  });

  it('success:false (with status) when Discord rejects the delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(404, 'unknown webhook'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequestPost({
      request: req({ action: 'notifyProjectDiscord', title: 't' }),
      env: ENV,
    });
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.status).toBe(404);
    vi.unstubAllGlobals();
  });
});

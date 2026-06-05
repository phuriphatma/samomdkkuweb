// Tests for the shared Discord notification core (queue + GAS caller) and
// the PR/VS sendNotify routing that now rides on it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  queueDiscord, callGAS, sendDiscord,
  setDiscordSpacing, getDiscordSpacing, __resetDiscordQueue,
} from './discord-queue.js';
import { sendNotify, actionFor } from './notify.js';
import { GAS_API_URL, GAS_VITAL_SOUND_URL } from './config.js';

const PROD_SPACING = getDiscordSpacing();
const fetchMock = vi.fn();

function okResp(obj = { success: true }) {
  return { ok: true, status: 200, text: async () => JSON.stringify(obj) };
}
// Let queued fire-and-forget work drain. With spacing 0 the queued task
// runs on the next microtask/macrotask; a single setTimeout(0) hop is
// past it.
const drain = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetDiscordQueue();
  setDiscordSpacing(0);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  setDiscordSpacing(PROD_SPACING);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('callGAS', () => {
  it('POSTs {action, ...payload} to the given url and returns parsed JSON', async () => {
    fetchMock.mockResolvedValue(okResp({ success: true, attempts: 1 }));
    const r = await callGAS('https://gas/exec', 'notifyX', { ticketId: 'T-1', n: 2 });
    expect(r).toEqual({ success: true, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gas/exec');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    expect(JSON.parse(opts.body)).toEqual({ action: 'notifyX', ticketId: 'T-1', n: 2 });
  });

  it('returns null and warns on a non-2xx response (e.g. Cloudflare 1015)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'error code: 1015' });
    expect(await callGAS('https://gas/exec', 'notifyX')).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('passes through an action-level success:false and warns', async () => {
    fetchMock.mockResolvedValue(okResp({ success: false, status: 404 }));
    const r = await callGAS('https://gas/exec', 'notifyX');
    expect(r).toEqual({ success: false, status: 404 });
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns null and warns on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await callGAS('https://gas/exec', 'notifyX')).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('aborts and returns null when the call exceeds timeoutMs', async () => {
    // Never resolve until aborted — the AbortController signal rejects it.
    fetchMock.mockImplementation((_url, opts) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
      });
    }));
    expect(await callGAS('https://gas/exec', 'notifyX', {}, { timeoutMs: 10 })).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('tolerates a non-JSON 2xx body (returns null, no throw)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => 'OK plaintext' });
    expect(await callGAS('https://gas/exec', 'notifyX')).toBeNull();
  });
});

describe('queueDiscord', () => {
  it('runs tasks serially in FIFO order (no interleaving)', async () => {
    const log = [];
    const task = (id, ms) => () => new Promise((res) => {
      log.push(`start${id}`);
      setTimeout(() => { log.push(`end${id}`); res(id); }, ms);
    });
    // task 1 is slower than task 2 — if they ran concurrently the ends
    // would interleave. Serial means start1,end1,start2,end2.
    const p1 = queueDiscord(task(1, 25));
    const p2 = queueDiscord(task(2, 1));
    const results = await Promise.all([p1, p2]);
    expect(results).toEqual([1, 2]);
    expect(log).toEqual(['start1', 'end1', 'start2', 'end2']);
  });

  it('isolates failures — a rejected task does not poison the next', async () => {
    const p1 = queueDiscord(() => Promise.reject(new Error('boom')));
    const p2 = queueDiscord(() => Promise.resolve('ok'));
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
  });

  it('enforces minimum spacing between consecutive calls', async () => {
    setDiscordSpacing(40);
    const starts = [];
    const stamp = () => () => { starts.push(Date.now()); return Promise.resolve(); };
    await Promise.all([queueDiscord(stamp()), queueDiscord(stamp())]);
    expect(starts).toHaveLength(2);
    // ~40ms gap (allow timer slack on the low side).
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35);
  });
});

describe('sendDiscord', () => {
  it('queues a logged GAS call and resolves with its result', async () => {
    fetchMock.mockResolvedValue(okResp({ success: true }));
    const r = await sendDiscord(GAS_API_URL, 'notifyProjectDiscord', { title: 'hi' });
    expect(r).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(GAS_API_URL);
  });
});

describe('actionFor', () => {
  it('maps system+mode to the GAS action name', () => {
    expect(actionFor('pr')).toBe('notifyPROnly');
    expect(actionFor('vs', 'submit')).toBe('notifyVSOnly');
    expect(actionFor('vs')).toBe('notifyVSOnly');
    expect(actionFor('vs', 'consult')).toBe('notifyVSConsult');
  });
  it('throws on an unknown system', () => {
    expect(() => actionFor('nope')).toThrow();
  });
});

describe('sendNotify (PR + VS routing over the shared queue)', () => {
  async function captureSend(system, payload) {
    fetchMock.mockResolvedValue(okResp());
    sendNotify(system, payload);  // fire-and-forget
    await drain();
    if (!fetchMock.mock.calls.length) return null;
    const [url, opts] = fetchMock.mock.calls[0];
    return { url, body: JSON.parse(opts.body) };
  }

  it('routes pr → notifyPROnly to the PR GAS endpoint, preserving payload', async () => {
    const sent = await captureSend('pr', { ticketId: 'PR-1', department: 'media' });
    expect(sent.url).toBe(GAS_API_URL);
    expect(sent.body.action).toBe('notifyPROnly');
    expect(sent.body.ticketId).toBe('PR-1');
    expect(sent.body.department).toBe('media');
  });

  it('routes vs submit → notifyVSOnly to the Vital Sound endpoint', async () => {
    const sent = await captureSend('vs', { mode: 'submit', ticketId: 'VS-9' });
    expect(sent.url).toBe(GAS_VITAL_SOUND_URL);
    expect(sent.body.action).toBe('notifyVSOnly');
    expect(sent.body.ticketId).toBe('VS-9');
  });

  it('routes vs consult → notifyVSConsult to the Vital Sound endpoint', async () => {
    const sent = await captureSend('vs', { mode: 'consult', ticketId: 'VS-9', notifyTo: 'se' });
    expect(sent.url).toBe(GAS_VITAL_SOUND_URL);
    expect(sent.body.action).toBe('notifyVSConsult');
    expect(sent.body.notifyTo).toBe('se');
  });

  it('is a no-op for an unknown system (no fetch, warns)', async () => {
    const sent = await captureSend('zz', {});
    expect(sent).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});

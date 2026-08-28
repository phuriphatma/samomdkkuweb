// analytics-email.test.js — the อีเมลแจ้งเตือน panel must never show a
// confident number it cannot stand behind.
//
// WHY THIS EXISTS. The owner asked "is 100 a day enough, and have we hit it?"
// Nobody could answer, because notify.js sends the email fire-and-forget
// (`callGAS(...).catch(() => {})`) and records nothing. Migration 0170 answers
// it by DERIVING the count from the notification fan-out — one in-app row per
// staff-seat holder, one email, same call.
//
// That derivation has exactly one failure mode, and it fails in the dangerous
// direction. In notify.js the two halves are gated SEPARATELY:
//
//     if (settings?.notify_uni_in_app !== false) { ...createNotification... }
//     if (settings?.notify_uni_email  !== false && to) { ...callGAS... }
//
// Switch the in-app half off and no rows are written while mail keeps going
// out. The panel would then read ZERO — "we send no email" — while email is
// being sent. A silent zero is worse than no panel, because a reader acts on
// it. So `in_app_enabled` rides along in the payload and the panel must SAY
// the number is untrustworthy.
//
// This is the repo's "a guard that fails green" shape, applied to a readout
// instead of a test: the ritual here is to feed the panel the state that
// breaks its assumption and require it to admit that, rather than render
// cleanly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/js/analytics-dashboard.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'src/css/analytics.css'), 'utf8');
const MIG = readFileSync(
  join(ROOT, 'supabase/migrations/0170_analytics_shows_email_use_against_the_quota.sql'), 'utf8');

/**
 * Run the panel for real rather than grepping for its source.
 *
 * A source grep is satisfied by a COMMENT — this repo has been burned by
 * exactly that (`confirm-modal.test.js` matched a comment, not a control). So
 * the function is extracted and executed against the payload shapes the RPC
 * actually returns, and the assertions are made on rendered OUTPUT.
 */
function renderPanel(email) {
  const start = SRC.indexOf('function emailPanel(');
  expect(start, 'emailPanel() is gone — the panel was renamed or removed').toBeGreaterThan(-1);
  const end = SRC.indexOf('\nfunction render(body, d) {', start);
  const body = SRC.slice(start, end);
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const barChart = () => '<!--chart-->';
  // eslint-disable-next-line no-new-func
  return Function('fmt', 'escHtml', 'barChart', `${body}\nreturn emailPanel;`)(
    fmt, escHtml, barChart);
}

const BASE = {
  quota_per_day: 100, staff_holders: 1, recipients: 1,
  enabled: true, in_app_enabled: true,
  sent_total: 93, peak_day: 7,
  sent_by_day: [{ d: '2026-08-24', n: 7 }],
};

describe('the อีเมลแจ้งเตือน panel', () => {
  const panel = renderPanel();

  it('renders the healthy case with no warning at all', () => {
    const html = panel(BASE);
    expect(html).toContain('7');
    expect(html).toContain('100');
    // A warning on the healthy case is worse than no warning — this repo has
    // paid for that too (the boot watchdog that fired on a slow-but-fine load).
    expect(html, 'the panel cries wolf at 7% of the quota').not.toContain('an-email-note--warn');
  });

  it('says the number is untrustworthy when in-app notifications are off', () => {
    const html = panel({ ...BASE, in_app_enabled: false, sent_total: 0, peak_day: 0 });
    expect(html, 'a silent zero: the panel showed no warning while mail was still sending')
      .toContain('an-email-note--warn');
    expect(html).toMatch(/เชื่อถือไม่ได้/);
  });

  it('distinguishes "switched off" from "cannot be trusted"', () => {
    const off = panel({ ...BASE, enabled: false });
    expect(off).toContain('an-email-note');
    // Email genuinely off is not an alarm — nothing is being missed.
    expect(off, 'a deliberately disabled feature must not read as a fault')
      .not.toContain('an-email-note--warn');
  });

  it('warns when the busiest day approaches the ceiling', () => {
    expect(panel({ ...BASE, peak_day: 85 })).toContain('an-email-note--warn');
    expect(panel({ ...BASE, peak_day: 49 })).not.toContain('an-email-note--warn');
  });

  it('counts RECIPIENTS, not messages — two addresses cost two per send', () => {
    // The Apps Script quota is per recipient. 40 sends x 3 addresses = 120,
    // over the ceiling, even though 40 messages looks comfortable.
    const html = panel({ ...BASE, recipients: 3, peak_day: 40 });
    expect(html, 'multi-recipient cost is not counted against the quota')
      .toContain('an-email-note--warn');
    expect(html).toContain('120');
  });

  it('survives a payload the RPC could not build', () => {
    expect(panel(null)).toBe('');
    expect(() => panel({})).not.toThrow();
  });

  it('every class the panel emits has a live CSS rule', () => {
    // A dead selector looks exactly like a feature nobody built, and CSS fails
    // silently. Assert the PROPERTY — that what is rendered can be styled —
    // rather than re-listing what the stylesheet happens to contain.
    const html = [panel(BASE), panel({ ...BASE, in_app_enabled: false })].join('');
    const classes = new Set();
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith('an-email')) classes.add(c);
    }
    expect(classes.size, 'the panel emits no an-email-* class — did it get restyled?')
      .toBeGreaterThan(2);
    for (const c of classes) {
      expect(CSS, `.${c} is rendered but has no rule in analytics.css`).toContain(`.${c}`);
    }
  });

  it('the migration ships the flag the panel depends on', () => {
    // The panel cannot warn about a field the RPC never sends.
    expect(MIG).toContain("'in_app_enabled'");
    expect(MIG).toContain("'recipients'");
    expect(MIG).toContain("'peak_day'");
    // And it must not reintroduce the shadowed variable that made the first
    // version deploy clean and fail on the first call.
    expect(MIG, 'the by_day CTE aliases `d` again — that name shadows the plpgsql range variable')
      .not.toMatch(/select day::date as d\b/);
  });
});

// ── The other half: a test email must not look like a real one ──────────
//
// A preview and the dev database send through the SAME Apps Script deployment
// as production, so a test notification lands in a real inbox indistinguishable
// from a real one. The screen has the env ribbon; email had nothing. An
// unmarked test message asking someone to sign a document is worse than a
// missing one, because they may act on it.
describe('email subjects say when the mail is not from production', () => {
  it('leaves production subjects untouched', async () => {
    const { markSubject } = await import('./projects/notify.js');
    expect(markSubject('[MDKKU SAMO] โครงการ ก — sent', 'production', 'samo.md.kku.ac.th'))
      .toBe('[MDKKU SAMO] โครงการ ก — sent');
  });

  it('marks a preview host even when the variable was forgotten', async () => {
    const { markSubject } = await import('./projects/notify.js');
    // The polarity the ribbon settled: an ABSENT var marks nothing on its own,
    // but the host still gives it away. That is the case a rebuilt box hits.
    expect(markSubject('x', undefined, 'abc123.samomdkkuweb.pages.dev')).toBe('[PREVIEW] x');
    expect(markSubject('x', undefined, 'samo.md.kku.ac.th')).toBe('x');
  });

  it('uses an explicit env name when there is one', async () => {
    const { markSubject } = await import('./projects/notify.js');
    expect(markSubject('x', 'dev', 'localhost')).toBe('[DEV] x');
  });

  it('does not re-implement the environment check', () => {
    // Two implementations of one rule drift. The ribbon's polarity was argued
    // out once and must not be re-derived here, where getting it wrong fails
    // SILENTLY instead of visibly.
    const src = readFileSync(join(ROOT, 'src/js/projects/notify.js'), 'utf8');
    expect(src, 'notify.js should call ribbonLabel, not test the host itself')
      .toContain('ribbonLabel');
    expect(src, 'notify.js grew its own pages.dev check — use ribbonLabel')
      .not.toMatch(/pages\\\\?\.dev/);
  });
});

// ── Only production may email the people configured in admin ────────────
//
// samo-dev is a full copy of production, so uni_staff_email arrives holding a
// real @kku.ac.th staff address, and dev + previews send through the SAME Apps
// Script deployment as production. Repointing the dev ROW fixed it once — but
// a stored value is not a guard: the next dev:refresh restores it, or somebody
// edits it in the dev admin UI, and a test flow mails a real person a document
// request that does not exist. Silently, both times.
//
// So the rule lives at the transport. These tests pin BOTH directions, because
// a guard that only proves "dev is blocked" cannot tell a working rule from a
// notification system that has stopped sending at all.
describe('only production emails the configured recipients', () => {
  const PROD_HOST = 'samo.md.kku.ac.th';

  it('production sends to exactly who admin configured', async () => {
    const { resolveRecipients } = await import('./projects/notify.js');
    expect(resolveRecipients('woratho@kku.ac.th', 'production', PROD_HOST))
      .toBe('woratho@kku.ac.th');
    // Several recipients must all survive — this is the ALLOW direction, and
    // silently dropping one would look exactly like the guard working.
    expect(resolveRecipients('a@kku.ac.th, b@kku.ac.th', 'production', PROD_HOST))
      .toBe('a@kku.ac.th,b@kku.ac.th');
  });

  it('a preview can only ever reach the test inbox', async () => {
    const { resolveRecipients, DEV_TEST_INBOX } = await import('./projects/notify.js');
    // Even though the dev database holds a REAL address, as it does after a
    // refresh from production.
    expect(resolveRecipients('woratho@kku.ac.th', undefined, 'abc.samomdkkuweb.pages.dev'))
      .toBe(DEV_TEST_INBOX);
    expect(resolveRecipients('woratho@kku.ac.th', 'dev', 'localhost')).toBe(DEV_TEST_INBOX);
    expect(resolveRecipients('a@kku.ac.th,b@kku.ac.th', 'preview', 'localhost'))
      .toBe(DEV_TEST_INBOX);
  });

  it('"email off" stays off in every environment', async () => {
    const { resolveRecipients } = await import('./projects/notify.js');
    // An empty setting must not become a send to the test inbox.
    for (const env of [['production', PROD_HOST], ['dev', 'localhost'], [undefined, 'x.pages.dev']]) {
      expect(resolveRecipients('', ...env), `empty setting leaked a send in ${env[0]}`).toBe('');
      expect(resolveRecipients(null, ...env)).toBe('');
      expect(resolveRecipients('not-an-address', ...env)).toBe('');
    }
  });

  it('EVERY send path resolves through the guard, not just the first one', () => {
    // The first version of this test asserted one SPELLING —
    // `normalizeRecipients(settings` — and passed while two other paths were
    // wide open: notifyProf (a real อาจารย์) and the admin "send test" button
    // (whatever is typed, no save needed). Assert the PROPERTY instead: every
    // file that hands an address to the mail action must obtain it from
    // resolveRecipients. A list built from the code the bug came from will
    // always agree with that code.
    const files = ['src/js/projects/notify.js', 'src/js/projects/manage.js'];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const sends = (src.match(/'notifyProjectEmail'/g) || []).length;
      if (!sends) continue;
      const guarded = (src.match(/resolveRecipients\(/g) || []).length
        - (f.endsWith('notify.js') ? 1 : 0);   // minus its own definition
      expect(guarded, `${f} has ${sends} mail send(s) but ${guarded} guarded recipient(s)`)
        .toBeGreaterThanOrEqual(sends);
    }
  });
});

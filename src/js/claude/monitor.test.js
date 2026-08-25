// ============================================================
// monitor.test.js — the Claude measurement on/off switch (migration 0167).
//
// Three separate things are guarded here and they fail for different reasons,
// so they are three describes rather than one:
//
//   1. the PURE state readers, on every shape the payload can take;
//   2. a DIFFERENTIAL against the SQL: the admin gate in this module and the
//      `claude_settings_write` policy are two implementations of one rule, and
//      every rule in this feature that has had two authors has drifted;
//   3. the REPORTER'S ORDER: it must read the switch before it touches
//      Anthropic, because "the pause costs them zero requests" is the entire
//      point and nothing else in the system can observe it.
//
// (3) reads source text, so it strips comments FIRST with the shared scanner.
// claude-usage-report.mjs opens with a hundred-line header that names the usage
// URL, `claude login`, `setup-token` and the endpoint's exact shape — a naive
// grep over that file finds every string it is looking for in prose and reports
// green on a file that does nothing.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MONITOR_ADMIN_ROLES, canEditMonitor, monitorState, staleAfterMs,
  pauseAge, pauseNeedsRelogin, RELOGIN_AFTER_DAYS,
} from './monitor.js';
import { actionFor } from '../notify.js';
import { stripComments } from '../strip-comments.js';

const board = (monitoring, extra = {}) => ({ settings: { monitoring, ...extra } });

describe('monitorState — what the board says about the switch', () => {
  it('reads an explicit pause, reason and stamp', () => {
    const st = monitorState(board({
      enabled: false,
      note: '  ยังไม่ได้ต่ออายุ Claude  ',
      changed_at: '2026-08-22T00:30:00Z',
      changed_by: { name: 'พู่กัน' },
    }));
    expect(st.enabled).toBe(false);
    expect(st.note).toBe('ยังไม่ได้ต่ออายุ Claude');
    expect(st.by).toEqual({ name: 'พู่กัน' });
    expect(st.changedAt.toISOString()).toBe('2026-08-22T00:30:00.000Z');
  });

  it('reads a running monitor', () => {
    expect(monitorState(board({ enabled: true, note: null })).enabled).toBe(true);
  });

  it('a payload with NO monitoring key reads as RUNNING, not as paused', () => {
    // The one place the safe default points the other way from this repo's
    // usual "fail closed". An absent key means an old bundle or a cached board
    // from before 0167 — a state in which nothing has been switched off,
    // because nothing had a switch. Defaulting to paused would paint an amber
    // banner with no reason in it over a board that is measuring fine.
    expect(monitorState({ settings: {} }).enabled).toBe(true);
    expect(monitorState({}).enabled).toBe(true);
    expect(monitorState(null).enabled).toBe(true);
    expect(monitorState({ settings: {} }).note).toBe('');
  });
});

describe('staleAfterMs — ONE threshold, and it comes from the database', () => {
  it('uses the published sample_stale_minutes', () => {
    expect(staleAfterMs(board(null, { sample_stale_minutes: 45 }))).toBe(45 * 60000);
    expect(staleAfterMs(board(null, { sample_stale_minutes: 90 }))).toBe(90 * 60000);
  });

  it('falls back to the COLUMN DEFAULT, not to the old hardcoded 35', () => {
    // The JS carried its own 35 minutes while the SQL believed the newest
    // sample for ever, so the page could print "ข้อมูลค้าง" over a figure the
    // database underneath was still treating as current. An old bundle should
    // read the board the way the current database does.
    expect(staleAfterMs({})).toBe(45 * 60000);
    expect(staleAfterMs(board(null, { sample_stale_minutes: 'nonsense' }))).toBe(45 * 60000);
    expect(staleAfterMs(board(null, { sample_stale_minutes: 0 }))).toBe(45 * 60000);
  });
});

describe('pauseAge — a duration, or nothing at all', () => {
  const at = (iso) => new Date(iso);
  const NOW = Date.parse('2026-08-25T12:00:00Z');

  it('formats minutes, hours and days', () => {
    expect(pauseAge(at('2026-08-25T11:30:00Z'), NOW)).toBe('30 นาที');
    expect(pauseAge(at('2026-08-25T04:00:00Z'), NOW)).toBe('8 ชม.');
    expect(pauseAge(at('2026-08-22T12:00:00Z'), NOW)).toBe('3 วัน');
    expect(pauseAge(at('2026-08-22T08:00:00Z'), NOW)).toBe('3 วัน 4 ชม.');
  });

  it('returns EMPTY rather than a zero for a missing or brand-new stamp', () => {
    // "0 นาที" beside a pause that started last week is a reading, not a blank
    // — the same rule that keeps this board from drawing an unmeasured 0%.
    expect(pauseAge(null, NOW)).toBe('');
    expect(pauseAge(at('2026-08-25T11:59:40Z'), NOW)).toBe('');
    expect(pauseAge(at('2026-08-26T00:00:00Z'), NOW)).toBe('');
  });
});

describe('pauseNeedsRelogin — warn before the credential dies, not after', () => {
  const NOW = Date.parse('2026-08-25T12:00:00Z');
  const daysAgo = (n) => new Date(NOW - n * 86400000);

  it('is quiet for a short pause and loud for a long one', () => {
    expect(pauseNeedsRelogin(daysAgo(3), NOW)).toBe(false);
    expect(pauseNeedsRelogin(daysAgo(11), NOW)).toBe(true);
    expect(pauseNeedsRelogin(null, NOW)).toBe(false);
  });

  it('fires BEFORE the 12-day refresh-token expiry it is warning about', () => {
    // A warning that arrives on the day the token dies is a post-mortem. The
    // 12 is Anthropic's refresh-token life, documented in
    // tools/claude-usage-report.mjs; the gap is the time to act.
    expect(RELOGIN_AFTER_DAYS).toBeLessThan(12);
    expect(pauseNeedsRelogin(daysAgo(RELOGIN_AFTER_DAYS + 0.5), NOW)).toBe(true);
    expect(pauseNeedsRelogin(daysAgo(RELOGIN_AFTER_DAYS - 0.5), NOW)).toBe(false);
  });
});

// ------------------------------------------------------------
// The differential: this module vs the RLS policy it mirrors.
// ------------------------------------------------------------
describe('canEditMonitor mirrors claude_settings_write', () => {
  /** The LAST migration that defines the policy wins — reading only the
   *  migration that FIRST defined it is how 0161 silently reverted 0158. */
  const MIG_DIR = new URL('../../../supabase/migrations/', import.meta.url);
  const policySql = (() => {
    const files = readdirSync(fileURLToPath(MIG_DIR)).filter((f) => f.endsWith('.sql')).sort();
    let found = null;
    for (const f of files) {
      const text = stripSqlComments(
        readFileSync(new URL(f, MIG_DIR), 'utf8'),
      );
      const m = /create policy claude_settings_write[\s\S]*?;/.exec(text);
      if (m) found = m[0];
    }
    return found;
  })();

  /** SQL line comments only — enough here, and deliberately not reused
   *  elsewhere. `--` inside a string literal would fool it; no policy body in
   *  this repo contains one, and the control below fails loudly if that ever
   *  stops being true. */
  function stripSqlComments(sql) {
    return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  }

  it('the instrument found the policy (a differential against nothing is not one)', () => {
    expect(policySql).toBeTruthy();
    expect(policySql).toContain('current_user_role()');
  });

  it('every role the policy names is in MONITOR_ADMIN_ROLES, and no others', () => {
    // Derived from the policy text, so adding a role in SQL and forgetting the
    // UI (or the reverse) fails here rather than at somebody's save button.
    const inSql = [...policySql.matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((v) => v !== 'master');           // a permission, not a role
    expect([...new Set(inSql)].sort()).toEqual([...MONITOR_ADMIN_ROLES].sort());
  });

  it('the policy checks `master`, and so does the JS — a role list cannot see it', () => {
    // Class 5. A `master` holder has role === 'user', so a gate written as a
    // role list alone hides the control from exactly the people who hold the
    // dev team's key.
    expect(policySql).toContain("current_user_has_permission('master')");
    expect(MONITOR_ADMIN_ROLES).not.toContain('master');
    expect(canEditMonitor({ role: 'user', master: true })).toBe(true);
  });

  it('answers both directions', () => {
    expect(canEditMonitor({ role: 'vp_admin' })).toBe(true);
    expect(canEditMonitor({ role: 'dev' })).toBe(true);
    expect(canEditMonitor({ role: 'user' })).toBe(false);
    expect(canEditMonitor({ role: null })).toBe(false);
    expect(canEditMonitor({})).toBe(false);
    expect(canEditMonitor()).toBe(false);
    // Truthiness is not permission: only `true` is.
    expect(canEditMonitor({ role: 'user', master: 'yes' })).toBe(false);
  });
});

// ------------------------------------------------------------
// Routing: the monitor modes must not fall through to the booking builder.
// ------------------------------------------------------------
describe('actionFor routes the monitor modes before the booking catch-all', () => {
  it('sends monitor events to their own action', () => {
    expect(actionFor('claude', 'monitor-off')).toBe('notifyClaudeMonitor');
    expect(actionFor('claude', 'monitor-on')).toBe('notifyClaudeMonitor');
  });

  it('leaves the three booking modes exactly where they were', () => {
    // The control. If the new branch were written loosely enough to swallow
    // these, the guard above would still pass and every booking notice would
    // silently become a monitor notice.
    for (const mode of ['new', 'edit', 'cancel', undefined]) {
      expect(actionFor('claude', mode)).toBe('notifyClaudeBooking');
    }
  });
});

// ------------------------------------------------------------
// The reporter's order. This is the half nothing else can observe.
// ------------------------------------------------------------
describe('the reporter asks the switch BEFORE it calls Anthropic', () => {
  const src = stripComments(
    readFileSync(new URL('../../../tools/claude-usage-report.mjs', import.meta.url), 'utf8'),
  );

  it('the instrument can still see the file (comments stripped, code intact)', () => {
    // The control that matters most here: this file's header is a hundred lines
    // long and NAMES the usage URL, `claude login` and `setup-token`. A stripper
    // that ate the code instead of the comments would leave a test that finds
    // every string it looks for and asserts nothing.
    expect(src).toContain('async function main()');
    expect(src).not.toContain('POLL EVERY 15 MINUTES');
  });

  it('the switch read appears before the usage fetch, in main()', () => {
    const main = src.slice(src.indexOf('async function main()'));
    const gate = main.indexOf('monitoringEnabled(');
    const call = main.indexOf('fetch(USAGE_URL');
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(call);
  });

  it('a paused tick exits 0 and never reaches the token refresh', () => {
    const main = src.slice(src.indexOf('async function main()'));
    const gate = main.indexOf('if (!gate.on)');
    const token = main.indexOf('await freshToken(');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(token);
    // exit(0), not exit(1): a paused reporter is a normal state, and a failed
    // systemd unit every 15 minutes is its own alarm.
    expect(main.slice(gate, token)).toContain('process.exit(0)');
  });

  it('the switch read FAILS CLOSED — only `true` means keep polling', () => {
    const fn = src.slice(src.indexOf('async function monitoringEnabled'));
    const body = fn.slice(0, fn.indexOf('async function main()'));
    // Every non-answer — a throw, a non-2xx, an unparseable body, a null from
    // an RLS-refused read — must return on:false. The shape that would break
    // this is a `catch` that returns true, or a `!== false` test.
    expect(body).toContain('value === true');
    expect(body).not.toMatch(/on:\s*true[\s\S]{0,40}catch/);
    expect((body.match(/on:\s*false/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('the 403 alert no longer recommends the command that CAUSES a 403', () => {
    // `claude setup-token` mints a user:inference token with no user:profile
    // scope — it is what produces the 403 this alert fires on. The alert told
    // a human to run it anyway, in the same embed whose วิธีแก้ said
    // `claude login`. Four times a day, for three days.
    const alert = src.slice(src.indexOf('if (res.status === 401'));
    const upToDie = alert.slice(0, alert.indexOf('die(`usage API HTTP'));
    expect(upToDie).not.toContain('setup-token');
  });
});

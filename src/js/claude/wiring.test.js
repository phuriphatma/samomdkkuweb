// จองโควตา Claude (migration 0154) — the three things about this feature that
// fail SILENTLY, each held down by an assertion instead of a comment.
//
// 1. A DISCORD WEBHOOK IN THE BUNDLE. The owner pasted the booking webhook into
//    chat, which is how this feature started, and the natural way to "just make
//    it post" is a fetch() straight from the browser. That would put a
//    credential into src/, which is served to every visitor of a PUBLIC site
//    from a PUBLIC repo. .claude/rules/security.md says webhook URLs live only
//    in the notify service's env; §A is the mechanism, not the sentence.
//
// 2. THE SESSION RULE, IMPLEMENTED TWICE. The 5-hour session arithmetic lives
//    in claude_sessions() and is what the INSERT trigger enforces with. The
//    calendar must RENDER those rows, never derive its own — two
//    implementations of one rule drift, and this repo pays for that class more
//    than any other. §B fails if the module starts building a session list.
//
// 3. A NEW PERMISSION KEY THAT ONLY REACHED SOME GATES. Class 5 in
//    .claude/rules/mistakes.md, the single most repeated bug here. The
//    sidebar/landing/pane half is already covered generically by
//    admin-landing.test.js; §C covers the half that is NOT — that the key can
//    actually be GRANTED, and that the RPC the board reads is gated on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';
import { PERM_CATALOG, ADMIN_FEATURES } from '../team-vocab.js';
import { actionFor } from '../notify.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const INDEX_JS  = read('./index.js');
const DISCORD   = read('../../../functions/_discord.js');
const MIGRATION = read('../../../supabase/migrations/0154_claude_quota_booking.sql');

// ── §A. No webhook may reach the browser ───────────────────────────────────
describe('the Discord webhook stays out of everything the browser downloads', () => {
  // Deliberately matches ANY Discord webhook, not the one booking URL: a guard
  // whose subject is a single hardcoded string goes blind the moment the URL is
  // rotated — and this one is being rotated, because it was exposed in chat.
  const WEBHOOK = /discord(?:app)?\.com\/api\/webhooks\//i;

  it('src/js/claude/index.js contains no webhook URL', () => {
    expect(WEBHOOK.test(stripComments(INDEX_JS))).toBe(false);
  });

  it('the booking notification goes through sendNotify, not a raw fetch', () => {
    const code = stripComments(INDEX_JS);
    expect(code).toContain("sendNotify('claude'");
    // The only fetches in this module must be the app's own REST helper.
    expect(code).not.toMatch(/fetch\(\s*['"`]https?:/);
  });

  it('_discord.js reads the webhook from env, never a literal', () => {
    const code = stripComments(DISCORD);
    expect(code).toContain('env.DISCORD_CLAUDE_WEBHOOK');
    expect(WEBHOOK.test(code)).toBe(false);
  });
});

// ── §B. One implementation of the session rule ─────────────────────────────
describe('the 5-hour session rule has exactly one home, and it is SQL', () => {
  it('the migration derives sessions and the trigger enforces with it', () => {
    expect(MIGRATION).toContain('create or replace function public.claude_sessions');
    expect(MIGRATION).toContain('claude_sessions(v_wk_start, v_wk_end)');
  });

  it('the calendar RENDERS board.sessions rather than computing its own', () => {
    const code = stripComments(INDEX_JS);
    expect(code).toContain('board.sessions');
    // The greedy build is what must not exist here. If a future edit starts
    // accumulating sessions client-side, these names are how it will read.
    expect(code).not.toContain('deriveSessions');
    expect(code).not.toMatch(/sessions\.push\(/);
  });

  it('claude_sessions() is NOT reachable by a signed-in account', () => {
    // It is SECURITY DEFINER over the whole table, so a grant to
    // `authenticated` would hand the board to accounts with no `claude` grant.
    // Proved live by tools/claude0154-quota-guard.sql §B4; pinned here so the
    // revoke cannot be dropped from the migration without a red test.
    expect(MIGRATION).toContain(
      'revoke all on function public.claude_sessions(timestamptz, timestamptz) from authenticated',
    );
  });
});

// ── §C. The permission key reached every gate ──────────────────────────────
describe('the `claude` permission key is grantable and enforced', () => {
  it('appears in PERM_CATALOG, so the ทีม SAMO grid can actually grant it', () => {
    expect(PERM_CATALOG.map((p) => p.key)).toContain('claude');
  });

  it('appears in ADMIN_FEATURES, so a claude-only grant opens /admin/', () => {
    // Without this, the one grant that IS this feature would be admitted by the
    // section gate and bounced at the door.
    expect(ADMIN_FEATURES).toContain('claude');
  });

  it('routes to its own notify action', () => {
    expect(actionFor('claude')).toBe('notifyClaudeBooking');
  });

  it('the notify Function knows that action', () => {
    expect(stripComments(DISCORD)).toContain("case 'notifyClaudeBooking'");
  });

  it('the board RPC checks the permission before returning anything', () => {
    expect(MIGRATION).toMatch(
      /get_claude_board[\s\S]*?current_user_has_permission\('claude'\)/,
    );
  });

  it('every RLS policy on the bookings table requires the permission', () => {
    const policies = [...MIGRATION.matchAll(
      /create policy (claude_bookings_\w+)[\s\S]*?;/g,
    )];
    expect(policies.length).toBeGreaterThanOrEqual(4);
    policies.forEach(([body, name]) => {
      expect(body, `${name} must test current_user_has_permission('claude')`)
        .toContain("current_user_has_permission('claude')");
    });
  });
});

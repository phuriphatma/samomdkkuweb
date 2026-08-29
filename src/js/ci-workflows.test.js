// ci-workflows.test.js — what CI is allowed to hold, and what it must not.
//
// TWO THINGS THIS PINS, both of which cost something on 2026-08-29.
//
// 1. NO WORKFLOW MAY HOLD A REPO SECRET. A live-proofs job was built, wired to
//    `SUPABASE_DEV_URL` + `SUPABASE_DEV_ACCESS_TOKEN`, and removed within
//    minutes: that token runs arbitrary SQL, `samo-dev` holds real student data
//    with no masking, and this repo is PUBLIC with five write-access
//    collaborators. GitHub withholds secrets from FORK PRs but hands them to
//    any workflow pushed on a BRANCH, so storing one would give all five that
//    token. The reasoning is `docs/TEAM-WORKFLOW.md` §7.9 — and a decision that
//    lives only in prose is one edit away from being undone by someone who
//    never read it. This is the mechanism version.
//
//    `secrets.GITHUB_TOKEN` is exempt: it is minted per-run, scoped by the
//    `permissions:` block, and is not a credential anybody chose to store.
//
// 2. CI MUST CHECK OUT FULL HISTORY. `actions/checkout` defaults to depth 1, so
//    `git cat-file` reports every commit but the tip as missing — which is
//    exactly what it reports for a mistyped sha. state-handoff.test.js verifies
//    the deployed sha that way, so the default checkout held `main` red from
//    2026-08-28, and because `build` is a REQUIRED status check that quietly
//    blocked every contributor PR. Nobody noticed: a check that is always red
//    is indistinguishable from a check.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const DIR = join(ROOT, '.github/workflows');

const workflows = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)) : [])
  .map((f) => ({ name: f, text: readFileSync(join(DIR, f), 'utf8') }));

describe('CI holds no credential', () => {
  it('there are workflows to check', () => {
    // Guard the guard: an empty directory would make every assertion below
    // pass vacuously, which is this repo's most-paid-for test failure.
    expect(workflows().length, 'no workflows found — this suite would pass over nothing')
      .toBeGreaterThan(0);
  });

  it('no workflow reads a stored repo secret', () => {
    const offenders = [];
    for (const { name, text } of workflows()) {
      for (const m of text.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (m[1] !== 'GITHUB_TOKEN') offenders.push(`${name} → secrets.${m[1]}`);
      }
    }
    expect(offenders, [
      'A workflow reads a stored secret. On a PUBLIC repo, any of the five',
      'collaborators can read it back out of a workflow they push on a branch.',
      'See docs/TEAM-WORKFLOW.md §7.9 — the safe shape is a GitHub Environment',
      'with the owner as a required reviewer, and that is an owner decision.',
    ].join('\n')).toEqual([]);
  });
});

describe('CI can see what it is checking', () => {
  it('the build job checks out full history', () => {
    const build = workflows().find((w) => w.name === 'build.yml');
    expect(build, 'build.yml is gone').toBeTruthy();
    expect(build.text, [
      'build.yml must check out with fetch-depth: 0.',
      'state-handoff.test.js resolves the deployed sha with git, and a depth-1',
      'checkout makes every valid sha look mistyped — that held main red for a',
      'day while `build` was a required status check.',
    ].join('\n')).toMatch(/fetch-depth:\s*0/);
  });
});

describe('the browser smoke tests the thing that breaks', () => {
  const smoke = () => readFileSync(join(ROOT, 'tools/smoke-browser.mjs'), 'utf8');

  it('asks the page the SAME boot question the in-page watchdog asks', () => {
    // A mirror: index.html's watchdog defines booted() as `window.__samoBooted
    // === true`. If the app ever changes that signal, a smoke test reading a
    // different one would pass over a dead page — the exact failure it exists
    // to catch.
    const entry = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(entry, "index.html's watchdog no longer uses __samoBooted")
      .toMatch(/window\.__samoBooted\s*===\s*true/);
    expect(smoke(), 'the smoke driver does not read the same boot signal the page sets')
      .toMatch(/__samoBooted\s*===\s*true/);
  });

  it('fails, rather than passes, when it cannot find a build to test', () => {
    const wf = workflows().find((w) => w.name === 'smoke.yml');
    if (!wf) return;                     // job is optional; the driver is not
    // "I could not test it" must never be scored as "it is fine".
    expect(wf.text, 'smoke.yml does not fail when no preview URL can be found')
      .toMatch(/exit 1/);
  });

  it('checks the ribbon in BOTH directions, or it proves nothing', () => {
    // A flag that only ever asserts presence cannot tell a working ribbon from
    // a broken one — this repo's deny-only-probe lesson, applied to a banner.
    expect(smoke()).toMatch(/--expect-ribbon/);
    expect(smoke()).toMatch(/--expect-no-ribbon/);
  });
});

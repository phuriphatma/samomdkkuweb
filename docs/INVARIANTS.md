# INVARIANTS — the things that will still be true next year

Split out of `STATE.md` on 2026-08-27, as designed in `docs/TEAM-WORKFLOW.md`
§6.5. That file had grown to 1,403 lines against a ~200-line target because it
was holding three different lifetimes at once, and it was unmergeable the moment
a second person edited it.

**The division, and it is the whole point:**

| Lives here | Lives in `STATE.md` | Lives in `docs/state/<handle>.md` | Lives in `docs/state-archive/` |
|---|---|---|---|
| rules that outlive a session | what is true RIGHT NOW | what MY session was | why it was done that way |
| deleted only when it stops being true | rewritten constantly | one file per person | never rewritten |

**Rule for agents:** write your own state file; never rewrite someone else's;
never touch `STATE.md`'s deploy block unless you deployed.

⛔ **Before correcting anything here, grep the WHOLE file for the claim's other
homes.** Splitting this content out was itself the occasion for finding four
facts that had two homes and had been corrected in only one — a deployed sha,
the migration high-water mark, the test count, and a proof count that read 20
where the runner registers 23.

---

## Live proofs — `npm run proofs`

⛔ **This file states NO proof count on purpose.** It used to say *"the registry
is now 20, all 20 run green on 2026-08-16"*; by 2026-08-27 the registry held 23
and the sentence had been wrong for days. `state-handoff.test.js` guards the
count — but only in `STATE.md`, and only in the spelling `ALL <n> PROOFS`, so
"the registry is now 20" was invisible to it. **The count lives in `STATE.md`,
once. `tools/run-proofs.mjs` is the authority; `npm run proofs` prints it.**
`npm run proofs`
runs every one; `npm run proofs <substring>` runs a subset. Run the one covering
what you touch — all are both-directional.

⚠️ **Do not check them with an ad-hoc parser** — they emit four different output
shapes and doing it by hand produced two false alarms in a row.
`tools/run-proofs.mjs` normalises them and reports UNKNOWN as a FAILURE.
**An ERRORED proof is silence, not a failure** — that is how one went stale for
three days while this file claimed it was green.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

**Full per-proof narrative — what each cost, how its subject is chosen, and the
traps in reading it — is in `docs/state-archive/2026-08-16-live-proofs.md`. Read
the entry for the proof you are about to touch.** One line each here:

- `authz-sweep-identity.sql` (23/23) — the identity boundary. Run after ANY
  policy change on `users`/`people`/`students`/`team_members`.
- `claude0154-quota-guard.sql` (20/20) — the จองโควตา Claude caps.
- `claude0155-free-now.sql` (22/22) — "how much may I use now, until when".
- `claude0157-rail-segments.sql` (10/10) — the rail's bands are CONSTANT and its
  edges are deadlines. Asserts the property, not a list of boundaries.
- `claude0159-window-share.sql` (32/32) — the window rule, and since 0160 the
  open-window rule.
- `claude0161-rail-guard-parity.sql` (10/10) — **the rail and the trigger derive
  the SAME window.** A DIFFERENTIAL over every quarter-hour of the week.
- `claude0162-usage-runs.sql` (23/23) — **ใช้จริง says WHEN Claude was used.**
  §A is the owner's worked example sample-for-sample; the rest are the states
  the live table cannot be made to contain on demand (a window first polled
  ABOVE where the previous ended, a reporter outage, the ±1s `resets_at`
  wobble). Uses SYNTHETIC samples in a future quota week for exactly that
  reason. Falsified by deleting the clamp.
- `pr0149-delete-permission.sql` (12/12) · `shop0150-buyer-contact.sql` (10/10) ·
  `house0116-authz.sql` · `house0144-delete-impact.sql` (18/18) ·
  `house0145-duplicate-person.sql` · `house0146-crest-refcount.sql` ·
  `team0145-one-chan-pi.sql` · `team0145-save-as-the-member.sql` ·
  `house0132-registry.mjs` · `proj0092-seat-parity.mjs` ·
  `team0135-name-split.mjs` · `team0137-search.mjs` · `grant0093-reads.mjs` ·
  `team0143-photo-refcount.mjs`

⚠️ **Two subjects that are not what they look like**, both paid for:
`shop0150`'s is MANUFACTURED (every real order belongs to a shop ADMIN, for whom
the guard early-returns, so a proof picking a real order reports that a buyer may
set a total to ฿1), and `house0144`'s picker must mirror the function's own `if`
or it selects nobody and ERRORS — which is silence, not a failure.

**The claude pane's colour system, since the owner asked for it:** clay
(`--claude-clay`, Claude's own) = MEASURED · green = free/available · ฝ่าย
colours = booked by a person · amber (`--claude-part`) = partly booked · red =
none left. The ramp's middle moved off `--brand-orange` because orange sits one
hue-step from clay and "partly booked" started looking like "actually used".

⚠️ **The claude pane has TWO TIME SCOPES and they are not interchangeable.** The
hero (`ใช้ได้เลยตอนนี้`) is about NOW; the week card is about the week the arrows
landed on. A future week measures **NULL, not 0** — a zero draws an empty bar and
reads as a reading.

⚠️ **`get_claude_board()` grows superlinearly with bookings** — ~25 ms at 7/week,
~100 ms at 30, polled every 60 s per open tab. Fine at this feature's real scale;
recorded so nobody rediscovers it in production.

## จองโควตา Claude — security posture

Verified 2026-08-16 and unchanged since; the detail moved to
`docs/state-archive/2026-08-16-claude-quota-booking.md`. The three facts that
matter: **nothing leaked to git** (the token appears in 0 commits), the
credential on the VM can burn QUOTA but **cannot spend money**
(`extra_usage.is_enabled=false`, `can_purchase_credits=false` — keep it that
way, that setting is doing real work), and `claude-reporter@samomdkku.app`
holds only `claude`. ⚠️ A `setup-token` pasted in chat is STILL LIVE; only the
owner can revoke it.

## 2026-08-17 — archived (scrutinize pass · master ≠ dev · the purge)

Full text: `docs/state-archive/2026-08-17-scrutinize-master-purge.md`. Only the
parts that are still LIVE rules are kept here:

- ⚠️ **`current_user_project_seats()` folds `master` → {vpa,staff,prof}.** A
  master holder IS a project actor and sees every หนังสือโครงการ.
  ❌ **The rest of this bullet used to read "the editor nulls project_seat on
  purpose — do not fix it". THAT WAS WRONG and it is why the bug below survived
  a whole session.** Access is folded; IDENTITY is not. The seat decides which
  screen the person gets AND is what `list_project_seat_users()` reads to build
  the notify audience, so nulling it stranded 36 of 41 masters on a blank pane
  and took them off every notification. Fixed 2026-08-18 (`7debbe9`); see the
  session block in the NEXT-SESSION PROMPT and
  `docs/mistakes/authz-grants.md`. **Never compute project visibility from the
  stored column — simulate the session.**
- ✅ **`claude0157` B4 is GREEN and self-contained — the follow-up this bullet
  used to ask for was DONE on 2026-08-25.** It plants a second synthetic booking
  and MOVES the quota week rather than searching live geometry for a slot. It was
  not tuned to pass: the new scenario found a real thing (where a window reset
  and a deadline coincide the instant is worth MORE than both neighbouring bands,
  so B1 became `>=` and B1b pins the coincident case).
- ⏳ **0161's cost claim (scrutinize finding 2) is still unbenchmarked.** Low
  priority, nothing depends on it.
- `master` needs `holdsMaster()` beside every `role === 'dev'` gate that grants
  power; the ~28 in `src/js/projects/*` are seat-driven and were left as-is per
  the owner.

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · หนังสือโครงการ · Analytics: unchanged. Write-ups in
`docs/state-archive/`; architecture in `docs/CONTEXT.md`.

- **Passport** (repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `2026-07-24-full.md`. Old project
  `idwlabpbwiwgaoqwbozz` is a cold backup — rotate its DB password before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording.
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`).

## Housekeeping

The memory layout is in `CLAUDE.md` § "Memory layout" — not repeated here,
because two copies of one rule is the class this repo pays for most.

- **Do not re-create `.claude/rules/mistakes-archive.md`** — it lived in the
  auto-loaded directory, so archiving into it saved nothing.
- **The design/plan docs were swept 2026-08-12 and now carry status banners.**
  **When a plan doc is finished, banner it the same day** — a stale plan with
  destructive steps (PASSPORT-MERGE still said "not started" while containing a
  `truncate passport.*`) is the most dangerous file in a repo.
- **Never hand-edit the mistakes index** — `npm run mistakes:index` generates it.
- **Never raise the context cap** when `npm run check:context` fails. Move detail
  into `docs/`.
- `.env.local` holds the Supabase PAT, the VM sudo pw, project-B DB creds.
- CI = Node 22. `npm run build && npm test` before every commit.

## จองโควตา Claude — READ THIS BEFORE TOUCHING `/admin#claude`

**The reasoning is archived: `docs/state-archive/2026-08-18-claude-quota-deep-dive.md`
(the 0154→0163 walk-through) and `2026-08-16-claude-quota-booking.md` (0154–0158).
Read one of them before changing anything here.** What stays below is only the
rules that change what you DO.

**THE RULE THAT GOVERNS (0159).** For every 5-hour window opened in the chain,
the bookings overlapping `[open, open + 5h)` may not claim more than 100%
together. A window is opened by the FIRST booking after a ≥5h gap, and the chain
is derived greedily in START order.

- ⛔ **"One home" means one FUNCTION, not one tier.** `claude_free_now()` asks
  `claude_window_loads()`; the rail asks the same. Do not re-derive a window
  from the clock anywhere (that was 0161).
- ⛔ **A window is identified by PROXIMITY to an instant, never by a rounded
  key** (0163). `date_trunc('minute', resets_at + 30s)` splits a window whenever
  the true reset lands near `:30`, and the split attributes the whole cumulative
  reading as a rise. Compare raw instants with a tolerance.
- ⛔ **Never `create or replace` one of these functions from its ORIGINAL
  migration text.** Several migrations have edited each. Take the body from
  `pg_get_functiondef` and diff. (Doing otherwise silently reverted 0158.)
- ⛔ **A guard re-derives state from the OTHER rows, so an earlier insert
  re-derives everyone** and nothing re-checks them. Tell: the same rows legal or
  illegal depending on TYPING ORDER. Re-derive WITH the candidate in it.
- ⛔ **Never put `overflow` clipping on `.claude-free`**, and **do not re-add the
  rail's width encoding** — it was built, reported, and pulled. The rail is
  **colour only**, by the owner's decision.
- ⛔ **Two quantities in one SUBTRACTION must share an INSTANT** (0156/0158).
- ⚠️ **This pane's bugs are PHONE bugs.** Six were phone-only and every one was
  invisible in the stylesheet. Open it at a phone width before calling it done.
- ⚠️ **`claude setup-token` CANNOT read usage** — it carries `user:inference`,
  not `user:profile`. The reporter's credential comes from `claude login` ON
  THE VM.

| Panel | Scope | Source |
|---|---|---|
| `ใช้ได้เลยตอนนี้` (hero) | this instant | `claude_free_now()` |
| the week card | the week ON SCREEN | `board.week.*` (0156) |
| the rail | per START TIME | `claude_free_windows()` |

⚠️ **`get_claude_board()` cost grows with bookings** — ~25 ms at 7/week, ~100 ms
at 30, polled every 60 s per open tab. Fine at real scale.


---

### ⚠️ Four traps these sessions walked into

- ✅ **THE CONTEXT BUDGET IS FINE — this bullet used to say the opposite and
  it was the second copy of a warning already deleted higher up.** It claimed
  `.claude/rules/mistakes.md` was at 29,725 of 30,000 with 275 bytes of
  headroom, so "the next write-up may turn `npm test` red before you have done
  anything wrong". **Measured 2026-08-26: 16,712 of 30,000 (56%); the whole
  auto-loaded set is 55%.** The 2026-08-25 restructure moved the per-entry
  index to `docs/mistakes/INDEX.md` and that is what bought the room.
  📌 **Two copies of one warning, and only ONE of them was corrected when it
  stopped being true — for a whole session this file asserted a fact in one
  place and called it false in another.** Exactly the drift class the repo
  documents, in the handoff itself. Grep the WHOLE file before believing any
  number in it, and when you correct a claim, grep for its second home.
  What is still true, and is a RULE rather than a number: if the budget is ever
  breached, **RESTRUCTURE, do not trim** — micro-trimming prose was tried twice
  and buys ~100 bytes an hour; `check-context-budget.mjs` measures BYTES and
  Thai costs 3 per character; and a byte cap on the index was tried and
  **REVERTED** because it truncated Thai symptom lines mid-word, which are the
  lead lines the index exists for. Run `npm run check:context` — never quote a
  remembered number.
- **A browser harness inlines `src/html/*.html` at generation time.** Edit the
  partial, re-run the probe, and it reads the STALE copy and reports the old
  text as if it shipped. Regenerate the harness after every partial edit.
- **A correlated subquery can SHADOW the alias you meant.** An app-wide sweep
  for orphaned uids wrote `not exists (select 1 from public.users u where
  u.id = id)` over a CTE column also called `id` — Postgres bound the inner
  `id` to `users.id`, so the predicate was `u.id = u.id` and every uid
  "resolved". It reported the database clean, including a table that provably
  held 298 orphans. **Name the extracted column something no table has
  (`uid_txt`), and run the sweep against a subject you KNOW is dirty before
  believing a zero.**
- **Slicing this file on `"## NEXT-SESSION PROMPT"` fails in BOTH directions.**
  `index()` finds the mention in the INTRO and truncates the file (twice).
  `rindex()` finds the mention in THIS trap list, which sits after the
  subsections you were trying to reach, and the slice then raises. Anchor on
  `"## NEXT-SESSION PROMPT (paste"` — the only occurrence that appears once.

### How this repo wants you to work

- **The owner tests live and reports in bursts**, often against code shipped
  minutes earlier, and increasingly from a phone. Treat their message as the
  test pass this repo does not have. Their reports are usually about MEANING:
  "ซึ่งใช้ร่วมกัน" was arithmetically true and said the wrong thing about who
  owns a session, and "อ่านครั้งเดียวจบ แล้วใช้ให้สนุก" was the wrong register
  for a document people are held to.
- **A fix on ONE path is not a fix** (class 4) and **prove it live in BOTH
  directions** (class 7) — both in the auto-loaded `.claude/rules/mistakes.md`.
- **When a hazard has been paid for twice, the third fix is a TEST.** Fifteen
  ratchets now. **Falsify each assertion before committing it** — and when a
  deliberate behaviour change reddens an old assertion, that is the guard
  working (0160 reddened `claude0159 §C3`), not a test to silence.
- **Batch commits before deploying** — each VM deploy is ~90 s. A `tools/`- or
  `docs/`-only commit needs no deploy.

### The decisions already made — do not re-litigate

Each was settled with the owner; the reasoning is in the archive file named.

- **The `master` grants reaching สมาชิกฝ่าย IT are INTENTIONAL** — confirmed
  twice (2026-08-14, 2026-08-15). That is the team that builds this app. Do
  not "fix" it and do not raise it a third time.
- **The ทีม SAMO admin-model rework is PARKED** at the owner's request.
  `docs/NEXT.md` §0a has the diagnosis and plan. Display structure and
  permission structure should NOT be separated — four `mode`s over ONE tree is
  the right pattern. ⚠️ The tree has been edited since (272 → 296 nodes);
  re-measure before acting on any count. Open question for them: **`house` is
  granted by NO node**, so ระบบบ้าน admin is role-only. Intentional or lost?
- **SAMO Shop stays open to BOTH login routes** — the checkout email is
  editable even when Google prefills it, so restricting the login method buys
  the LOOK of a verified contact and none of it.
- **The sign-in modal's copy is settled after SIX reports.** Read the entry in
  `docs/mistakes/frontend-ui.md` BEFORE touching it; guarded by
  `signin-screen.test.js`. No email domain anywhere in the modal, ever.
- **The org chart: the owner's asks are about ผังรวม**; they explicitly do not
  want แผนผัง reworked.

### 1b. The public org chart (`/team`)

**Fully archived — read `docs/state-archive/2026-08-15-late-org-chart-reporting.md`
before touching any of the four views.** The two rules that get rediscovered
the hard way: **FOUR views, TWO parentages** (รายการ+แผนผัง draw CONTAINMENT,
ผังองค์กร+ผังรวม draw REPORTING — do NOT unify them, that is what made แผนผัง
a 52,000px staircase), and **"แสดงถึง" is a KIND, not a depth**. Display rules
live in `src/js/org-rung.js`, guarded by `org-rung.test.js`.

### 2. Invariants that will bite you

- **`public.people` is the person registry.** `students.person_id` /
  `team_members.person_id` are PLACEMENTS, both `ON DELETE SET NULL`. Both
  mirrors are guarded by `is distinct from`, and **that guard is the
  TERMINATION CONDITION**. A mirror is only bidirectional on the columns BOTH
  directions NAME.
- **Deleting a นักศึกษา is two different deletes** — `student_delete_impact()`
  (0144) is the only correct way to tell them apart.
- **`team_members` has NO unique key on kkumail, on purpose** — 82 people hold
  2–4 ตำแหน่ง. `students.kkumail` IS unique. Do not "fix" the asymmetry.
- **Nothing may re-add a role branch to `users_read_all`** — `role` and
  `permissions` share the row, so a full read maps who holds `master`.
- **ชั้นปี IS NOT STORED.** `src/js/study-year.js` computes it; never spread a
  row and overwrite only `student_id` — call `yearBasis(stored, typed)`.
- **A "fill only if empty" prefill is safe only while the IDENTITY behind it
  cannot change.** The account switcher does not reload, so any such prefill
  must remember WHOSE data it holds (`applyBuyerPrefill`, `prefillUid`).
- **A client-side count over an RLS-gated table is a fail-open** — RLS returns
  ZERO ROWS, not an error. Count server-side.
- **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
  named and took ระบบบ้าน's admin tab down for 20 minutes.
- **A TRASHED Drive file is still served publicly** by `lh3`.
- **`set_config(…, true)` is TRANSACTION-scoped** and `reset role` does not
  clear it.
- **A guard's INSTRUMENT needs a guard.** Comment stripping, bundle grepping
  and result parsing all silently change what a test can SEE, and a wrong
  instrument makes a test PASS. Use `src/js/strip-comments.js` and
  `npm run proofs`, never a fresh regex.
- **Grep the SHARED chunk, not just `public-*.js`.** `ใต้สังกัด` reads 0 in the
  public bundle and 1 in `analytics-*.js`, which `/team` also loads. That cost
  a false "the deploy did not take" on 2026-08-15.

---

## Where the reasoning is — `docs/state-archive/`, newest first

Annotated, because the annotation is the useful part. This list lived in
`STATE.md`'s header until the split.

- **`2026-08-27-state-split.md`** — this split, plus the per-deploy
  verification log and the old prompt preamble as appendices.
- `2026-08-18-daytime.md` — ปีงบ default + the `sastaff`/`saprof` purge.
- `2026-08-18-claude-quota-deep-dive.md` + `2026-08-16-claude-quota-booking.md`
  — **read one before touching `/admin#claude`**.
- `2026-08-17-scrutinize-master-purge.md` — the 15-account purge, `master` ≠
  `dev`, the 0164 scrutinize pass. ⚠️ its *"sastaff/saprof were KEPT"* line is
  now FALSE; see the header it carries.
- `2026-08-15-late-org-chart-reporting.md` — the two parentages, ระดับ, colour.
  **Read before touching `/team`.**
- `2026-08-15-org-chart-views.md` — the d3 views, the library survey, three
  portrait bugs.
- `2026-08-12-signin-shop-guards.md` · `2026-08-10-late-security-and-identity.md`
  · `2026-08-10-chan-pi.md` · and nine older files back to `2026-07-24-full.md`.

---

## Reason about the LIVE channel, not the credential that was removed

Moved out of `STATE.md` 2026-08-27 when it stopped being a status item; it is a
rule, and it was re-derived wrongly twice before the owner corrected it.

`sastaff` / `saprof` were deleted on 2026-08-18 along with the other shared
password accounts. **Two sessions then recorded that the people behind those
desks had been locked out. They had not been.** Worapong (`woratho@kku.ac.th`,
seat `staff`) and Prakasit (`prakasa@kku.ac.th`, seat `prof`) sign in with their
own kkumail and hold the desk through their **ทีม SAMO permission** — the seat,
not the login.

**The rule:** when a credential is deleted, ask what channel actually grants the
access, and check whether it survived. A removed password is evidence about a
password. It is not evidence about a permission, a seat, or a role — those are
different channels, and this repo's most repeated bug class is exactly that
confusion (class 5 in `.claude/rules/mistakes.md`).

---

## A head-count is a METHOD, not a fact

Moved out of `STATE.md` 2026-08-27. The `claude` permission grant was recorded
there as "~154 accounts, plus 42 `master` holders". Those were **146 and 41
eight days earlier**, and the `claude` count moved 153 → 154 inside a single
day — the owner edits the ทีม SAMO tree continuously, so any number written
down is a photograph, not a state.

**Never quote one. Re-run it:**

```sql
select count(*) from public.users
 where 'claude' = any(permissions) or 'claude' = any(managed_permissions);
```

The same applies to the `master` list, the node count in the tree, the number of
migrations, the test count and the proof count — every one of them has been
wrong in this repo's own documentation at least once. Where a count MUST be
written (the migration high-water mark, the test count), it gets exactly one
home and a guard; everywhere else, write the query instead.

⚠️ **A related excuse that must not be re-derived:** an old note said
`claude0157` B4 was red *because* `claude_bookings` is empty. It is NOT red —
0157 was made self-contained on 2026-08-25 by MOVING the quota week and planting
synthetic bookings, rather than hoping the live calendar would cooperate. **A
proof that depends on real usage existing is the thing that was fixed.**

---

## A systemd timer fixed BY HAND on the VM is one rebuild from coming back

Moved out of `STATE.md` 2026-08-27 — it is a rule, not a status.

The Claude usage timer carries `OnActiveSec=1min`, added **by hand** in
`/etc/systemd/system/` on the VM. **`server/deploy.sh` does not touch unit
files**, so a deploy will never restore it; only `server/setup.sh` would, on a
rebuilt box.

Without it, `systemctl enable --now` after a multi-day `disable` reports
**`enabled`** and **`active`** while scheduling **`infinity`** — the timer is on
by every word systemd prints, and will never fire.

**The rule: read `NEXT` from `systemctl list-timers`, never the word
`enabled`.** `enable` is not `schedule`; a unit whose only triggers are
`OnBootSec` + `OnUnitActiveSec` has nothing to count from until something
activates it, so anchor at least one trigger to the timer's own activation.
Write-up in `docs/mistakes/deploy-hosting.md`.

**And the general shape:** any fix applied directly to a server, outside the
files a deploy replays, is invisible to every later deploy and to everyone
reading the repo. If it must survive, it belongs in `server/setup.sh`; if it
cannot, it belongs here, written down.

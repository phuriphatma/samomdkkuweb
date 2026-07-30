# 2026-07-30 — passport authorization closed, and the public org chart

Moved out of `STATE.md` at session end. Both items are DONE and deployed; this is
the narrative record. Live constraints and remaining follow-ups stay in STATE.md.

## Passport authorization (passport `db/0010` + `0011` + `0012`)

The hole is closed. `node tools/pass-anon-probe.mjs` — the real anon key over
HTTPS — went **6/9 → 9/9**. Before: `profiles?select=email` returned real
`@kkumail.com` addresses, `user_tiers` returned the whole roster, and
`PATCH /scans` was **accepted**. Now all three are refused, while the catalog and
scan-points reads the app needs pre-login still work.

**Both admin doors work, and that was the hard part.** `admin`/`1234` had no
server identity — a password compared in JavaScript produces none — so it could
never be granted anything the anonymous public wasn't. It now signs into ONE
shared Supabase account (`passportadmin@samomdkku.app`, `permissions={passport}`)
on its OWN client with its OWN `storageKey`, so it carries a real JWT and cannot
disturb anyone's personal Google session. Verified end-to-end over HTTPS with the
real credentials against the locked-down DB: sign-in 200, `admin_leaderboard` 200,
`profiles` read 200, admin `PATCH activities` 200.

**Proofs — re-run both after ANY passport authz change:**
- `node tools/pass-hardening.mjs` — **60/60**. Applies 0011 inside a rolled-back
  transaction and checks seven principals: anon, a real @kkumail student, a
  non-kkumail account, a migrated-away account, a blanket-`passport` admin, a
  one-department admin, and the shared `admin`/`1234` account.
- `node tools/pass-anon-probe.mjs` — **9/9**. Prod-safe by construction.

**What each migration did**
- `0010` (additive): `is_admin()`/`admin_covers_dept()` wrapping
  `public.passport_admin_context()` (the ทีม SAMO tree stays the only admin
  channel — deliberately NO `passport.admins` table); `stamp_scan()` taking the QR
  token, `points_awarded` and `user_id` server-side and enforcing the
  kkumail/migrated gate that was client-side only; `profiles_guard`
  (`total_km`/`tier_override` server-managed, exempted by TRIGGER DEPTH because
  SECURITY DEFINER does not clear `auth.uid()`); `admin_leaderboard()`
  re-applying the caller's ฝ่าย scope inside the definer; `leaderboard_names()`
  as an id+full_name projection; `user_tiers security_invoker=on`.
- `0012`: dropped `scans_insert` — `stamp_scan()` is the only inserter anywhere.
- `0011`: the lockdown. Writes admin-only; `profiles` + `season_results` reads
  narrowed to self-or-admin.

**Deliberately still `using (true)` — 7 SELECT policies, all non-personal**:
`activities`, `certificates`, `samo_years`, `samo_seasons`, `seasons`, `scans`,
`account_migrations`. The scan page must resolve an activity BEFORE sign-in and
the public ranking needs the points.

**Two follow-ups, neither urgent:**
1. **`activities.static_token` is readable by anon**, because the whole row is.
   RLS cannot hide a column. Impact is now small — `stamp_scan()` pins the scan to
   `auth.uid()` and derives the km itself, so a leaked token only lets a
   signed-in kkumail student stamp an activity they didn't attend. To close it:
   drop the `isStaticMatch` client pre-check (the server validates the token now),
   switch `scanning.js` to an explicit column list instead of `select('*')`, then
   `revoke select (static_token) on passport.activities from anon, authenticated`.
   Do it in that order or the scan page 400s.
2. **Per-ฝ่าย WRITE scoping**: the write policies check `is_admin()`, not the
   department, so a ฝ่าย-scoped admin can still edit another ฝ่าย's activity with
   DevTools. `admin_covers_dept(dept, sub_dept)` already exists for it. Pointless
   while the all-departments `admin`/`1234` door is open, so sequence it after
   retiring that door.

**The disclosure concern is resolved by this** — the exploit detail I pushed to
the public repo now describes a closed hole. Still: **do not commit still-open
vuln detail to either repo; both are PUBLIC.**



## The public org chart (samoweb migration 0103)

Public page at `/team`
  (`pills-team-public`, `src/js/org-chart.js` + `src/css/org-chart.css`), fed only
  by `get_public_org_chart()`. Migration **0103** added `team_members.photo_url`
  (capped 500 chars) and named it in the projection — a new column on
  `team_members` is still NOT published until it is named there, which is the whole
  point of building that jsonb key by key. Verified as anon: 279 ตำแหน่ง /
  401 members returned, `team_members` itself reads 0 rows, and the serialized
  chart contains no `@` and none of `student_id|kkumail|permissions|vs_dept|
  project_seat|user_id|major|confirmed`. `tools/proj0086-seats.mjs` still 24/24.
  Portraits upload from the ทีม SAMO member form via `uploadImageToDrive`;
  `convertDriveUrl` runs at RENDER time too, so legacy `thumbnail?id=` URLs are
  rewritten to the iOS-safe lh3 form. Initials are layered UNDER the photo so a
  rotted Drive link degrades to initials instead of an empty disc.
  **Privacy note**: a member's name + photo become public as soon as their
  ตำแหน่ง is in a public subtree. `team_nodes.is_public` is the control; there is
  no per-member opt-out today, and photos are opt-in only in the sense that
  someone has to upload one.

## The shared-account door, in one paragraph

`admin`/`1234` was a client-side string compare, so it carried no server identity
and could not be granted anything the anonymous public was not — which made "close
the RLS hole" and "keep that door working" mutually exclusive. It now signs into
one shared Supabase account (`passportadmin@samomdkku.app`, `permissions={passport}`)
on its own client with its own `storageKey`, so it holds a real JWT and cannot
disturb an organiser's personal Google session. The shared password ships in the
bundle exactly as `'1234'` did, so the door is no more secure than before; what
changed is that everyone NOT using it has no write access, and admin writes now
carry a uid. Credentials live in `VITE_PASSPORT_ADMIN_*` on this Mac and on the VM,
never in the public repo.

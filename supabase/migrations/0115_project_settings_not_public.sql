-- ============================================================
-- 0115 — project_settings is no longer world-readable
--
-- Found while sweeping every anon-reachable read path of หนังสือโครงการ
-- for 0114. `project_settings_read_public` (0032) was
-- `for select to anon, authenticated using (true)` over a table whose
-- singleton row carries `uni_staff_email` — the receiving officer's real
-- KKU address. Any visitor could read it straight off the public mirror's
-- own API. 0032's own comment predicted this ("if exposing that is
-- sensitive, add a column-select policy or a dedicated public view in a
-- follow-up"); the follow-up never came.
--
-- The reason it was published was the display labels. It turns out the
-- customer renderer never used them: `ownerLabel()` reads `uni_label` /
-- `vp_label`, which are not columns on this table (they are
-- `uni_staff_label` / `vp_admin_label`), so it has always fallen through
-- to its hardcoded defaults. Nothing on the public mirror consumes this
-- row, so the fix is to stop serving it rather than to project it.
--
-- After this, the only SELECT policy left is `project_settings_read`
-- (actors + the professor), which is what every staff caller already uses.
-- An anon SELECT now returns zero rows rather than an error, and
-- mountCustomerProjects()'s `getSettings().catch(() => null)` already
-- renders with `settings: null` — so no caller breaks.
--
-- Apply AFTER 0114. Re-runnable.
-- ============================================================

drop policy if exists "project_settings_read_public" on public.project_settings;

comment on table public.project_settings is
  'Singleton config for หนังสือโครงการ. Holds uni_staff_email — the officer''s '
  'real address — so it is NOT public: readable by project actors and the '
  'professor only (0115 removed the anon policy 0032 added). Anything the '
  'public mirror needs must be a projection, never a policy on this table.';

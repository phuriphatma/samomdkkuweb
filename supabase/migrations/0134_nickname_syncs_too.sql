-- ============================================================
-- 0134 — ชื่อเล่น syncs too
--
-- REPORTED: "when i change ชื่อเล่น in teamsamo, it doesn't change in ระบบบ้าน".
--
-- Measured before fixing (phuriphat.ma@kkumail.com):
--   team_members.nickname   = 'เอิงงง'   ← the admin's edit
--   people.nickname         = 'เอิงงง'   ← the mirror UP worked
--   students.nickname_self  = 'เอิง'      ← never moved
--   students.nickname       = 'เอิง'      ← so the card still said the old one
--
-- CAUSE. 0132's `person_mirror_down` writes eight columns to `students` and
-- `nickname` is not among them. I left it out on purpose and for a reason that
-- was half right: `students.nickname` IS a generated column
-- (`coalesce(nullif(nickname_self,''), nickname_imported)`) and writing it would
-- be a 428C9. What I then failed to do is write the SOURCE columns it is
-- generated from — so the exclusion silently became "ชื่อเล่น never syncs".
--
-- A generated column is not a reason to skip a field. It is a reason to write
-- the field it is derived from.
--
-- WHICH SLOT. `nickname_self` beats `nickname_imported` by construction, and
-- that pair exists for exactly one purpose: stopping a CSV re-import from
-- reverting what a person typed (0125). It was never meant to arbitrate between
-- the registry and the import.
--
-- The mirror writes `nickname_self`, and that is deliberate:
--   • The registry's nickname is always the most recently AUTHORITATIVE value —
--     it got there either from the person's own card (update_my_identity) or
--     from an admin editing a workspace. Both outrank an import.
--   • Writing `nickname_imported` instead would leave the visible ระบบบ้าน value
--     unchanged for anybody who has ever set their own — which is precisely the
--     person in the bug report, and precisely the case that made this visible.
--   • Precedence stays **admin > student > import**, which is the rule 0125
--     states on the table.
--
-- The small lie is that `nickname_self` now sometimes holds a value an ADMIN
-- typed rather than the student. That is a naming wart, not a behaviour bug:
-- the column's real meaning has always been "the value an import may not
-- overwrite", and an admin's correction qualifies. Renaming it to say so is
-- CONTRACT-step work (docs/PERSON-REGISTRY.md), not something to do while
-- fixing a live sync gap.
--
-- Rebuilt from the LIVE 0132 body, not from the migration text.
-- ============================================================
create or replace function public.person_mirror_down()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.team_members m
     set full_name   = new.full_name,
         nickname    = new.nickname,
         year        = new.year,
         major       = new.major,
         photo_url   = new.photo_url,
         photo_focus = new.photo_focus,
         student_id  = new.student_id,
         kkumail     = new.kkumail,
         user_id     = coalesce(new.user_id, m.user_id)
   where m.person_id = new.id
     and (m.full_name, m.nickname, m.year, m.major, m.photo_url,
          m.photo_focus, m.student_id, m.kkumail)
         is distinct from
         (new.full_name, new.nickname, new.year, new.major,
          new.photo_url, new.photo_focus, new.student_id, new.kkumail);

  -- The house half. `sai_code` is NOT here and never will be: it is the
  -- university's advisor assignment and it decides the house, so it belongs to
  -- the placement, not to the identity.
  --
  -- `nickname_self` carries the nickname (0134) — `students.nickname` itself is
  -- GENERATED and writing it would 428C9. The guard compares the GENERATED
  -- value, because that is what a reader sees and therefore what "already in
  -- sync" has to mean; comparing `nickname_self` would keep firing forever for
  -- a row whose value comes from `nickname_imported`.
  update public.students s
     set first_name_th = new.first_name_th,
         last_name_th  = new.last_name_th,
         nickname_self = coalesce(new.nickname, s.nickname_self),
         student_id    = new.student_id,
         major         = new.major,
         year_offset   = new.year_offset,
         photo_url     = new.photo_url,
         photo_focus   = new.photo_focus,
         bio           = new.bio
   where s.person_id = new.id
     and (s.first_name_th, s.last_name_th, s.nickname, s.student_id, s.major,
          s.year_offset, s.photo_url, s.photo_focus, s.bio)
         is distinct from
         (new.first_name_th, new.last_name_th, new.nickname, new.student_id,
          new.major, new.year_offset, new.photo_url, new.photo_focus, new.bio);
  return new;
end;
$$;

-- Reconcile the rows already out of step. Registry → students, because the
-- registry is where every editor's value has been landing since 0133.
update public.students s
   set nickname_self = p.nickname
  from public.people p
 where s.person_id = p.id
   and p.nickname is not null
   and coalesce(s.nickname, '') is distinct from coalesce(p.nickname, '');

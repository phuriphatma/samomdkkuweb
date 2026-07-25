-- ============================================================
-- 0085 — current_user_is_vs_handler() must fail CLOSED on a null role
--
-- Found by tools/vs0083-scope.mjs: for a caller with no public.users row
-- (and for anon), `public.current_user_is_staff()` returns NULL — not false —
-- because it reduces to `current_user_role() in (...)` and `null in (...)` is
-- NULL. 0084's helper ORs that term, so the whole expression evaluated to
-- NULL rather than false:
--
--   select current_user_is_staff(), current_user_vs_scope(), current_user_is_vs_handler()
--   → (null, '{}', null)     -- wanted: (null, '{}', false)
--
-- Two consequences, one of them a hard break:
--   1. vs_public_comments.is_staff is NOT NULL, and vs_post_public_comment
--      inserts this value — so a signed-in user WITHOUT a public.users row
--      could not post on the board at all (23502 not-null violation). The
--      same latent shape existed in 0072/0078, which inserted
--      current_user_is_staff() directly.
--   2. Any future `if current_user_is_vs_handler() then …` guard would skip
--      its then-branch on NULL — the fail-OPEN direction if the branch is
--      the rejection. Same family as 0045 (`null in (...)` guards).
--
-- Fix: coalesce the nullable term. `x is null` and `cardinality(x) > 0` on a
-- non-null array are already two-valued, so the staff term is the only hole.
-- ============================================================

create or replace function public.current_user_is_vs_handler()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_is_staff(), false)
      or public.current_user_vs_scope() is null
      or coalesce(cardinality(public.current_user_vs_scope()) > 0, false)
$$;

comment on function public.current_user_is_vs_handler() is
  'True when the caller acts for SAMO on VitalSound: any staff role, a full '
  '`vs` grant, or a per-ฝ่าย SAMO Team scope (0083/0084). Never NULL — an '
  'unknown caller is false (0085). Use for IDENTITY (the เจ้าหน้าที่ badge) — '
  'NEVER for reading dept-scoped confidential data, which must additionally '
  'test target_dept against current_user_vs_scope().';

grant execute on function public.current_user_is_vs_handler() to anon, authenticated;

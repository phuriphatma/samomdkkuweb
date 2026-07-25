-- ============================================================
-- 0088 — the scope helpers must return '{}', never NULL
--
-- Found by the end-of-session bug scan. As the bare `anon` role:
--   current_user_vs_depts()      → NULL   (wanted '{}')
--   current_user_project_seats() → NULL   (wanted '{}')
-- Both are `select coalesce(col,'{}') from public.users where id = auth.uid()`
-- — the coalesce guards a NULL COLUMN, but a scalar subquery over ZERO ROWS
-- (no users row, e.g. anon) still yields NULL.
--
-- Harmless where they are used TODAY (a policy branch evaluating to NULL is
-- not TRUE, so every current call site fails closed), but it is precisely the
-- shape that fails OPEN in a guard — `if not (x = any(f())) then raise` never
-- raises when f() is NULL, because `NOT NULL` is NULL and IF only fires on
-- TRUE. That is the 0045 bug (`null in (...)`), one indirection further out.
-- Fix it at the definition so no future caller has to remember.
--
-- current_user_vs_scope() (0083) already aggregates and correctly returns '{}'.
-- ============================================================

create or replace function public.current_user_vs_depts()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(u.managed_vs_depts, '{}') from public.users u where u.id = auth.uid()),
    '{}'
  )
$$;

create or replace function public.current_user_project_seats()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(u.managed_project_seats, '{}') from public.users u where u.id = auth.uid()),
    '{}'
  )
$$;

grant execute on function public.current_user_vs_depts()      to anon, authenticated;
grant execute on function public.current_user_project_seats() to anon, authenticated;

-- ============================================================
-- 0036 — Contact phone on public.users
--
-- Every signed-in user can save a contact phone number in the
-- profile modal (จัดการบัญชี). It autofills the samoshop checkout
-- buyer-phone field (src/js/shop/checkout.js already reads
-- user.phone). Nullable; empty/unset for everyone until they fill it.
--
-- Writes: the existing 0001 `users_update_self` RLS policy already
-- lets a user UPDATE their own row, and the 0028 self-update guard
-- only blocks privileged columns (role / permissions / method /
-- has_password / id / username-rename) — `phone` is NOT guarded, so
-- a user PATCHing their own phone passes. No policy change needed.
--
-- Additive + idempotent: safe to re-run.
-- ============================================================

alter table public.users
  add column if not exists phone text;

comment on column public.users.phone is
  'User-set contact phone. Autofills samoshop checkout buyer phone. '
  'Self-writable (not a privileged column per 0028 guard).';

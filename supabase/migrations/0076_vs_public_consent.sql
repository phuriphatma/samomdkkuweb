-- ============================================================
-- 0076 — VS submitter consent to publish (กระดานปัญหา)
--
-- The report form now asks the submitter whether they consent to their issue
-- being published (anonymously, SE-curated) on the public board:
--   vs_tickets.public_consent:
--     true  → student opted in  (SE still approves + writes the headline)
--     false → student DECLINED  (vs_set_public hard-rejects publishing)
--     null  → legacy ticket / not asked (SE judgment, allowed — keeps every
--             pre-0076 ticket publishable exactly as before)
--
-- Fail-closed only on an explicit decline: consent is a privacy promise to
-- the student, so the block lives server-side in the RPC, not just in the UI.
-- Column is written by the public INSERT (insert-open RLS, same trust level
-- as `problem` itself) and is immutable-in-practice: staff UPDATE paths never
-- touch it, and the submitter has no UPDATE policy on other columns anyway.
-- ============================================================

alter table public.vs_tickets
  add column if not exists public_consent boolean;

comment on column public.vs_tickets.public_consent is
  'Submitter consent to anonymous board publication: true=opted in, false=declined (vs_set_public rejects), null=legacy/not asked. See 0076.';

-- vs_set_public: identical to 0072 + the explicit-decline reject.
create or replace function public.vs_set_public(
  p_id     text,
  p_public boolean,
  p_title  text default null,
  p_note   text default null,
  p_category text default null   -- optional: set/override the ticket's category
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_tk   public.vs_tickets;
  v_cat  text;
  v_conf boolean;
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev') or public.current_user_has_permission('vs')
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_tk from public.vs_tickets where id = p_id and deleted_at is null;
  if not found then raise exception 'VS ticket not found: %', p_id using errcode = 'P0002'; end if;
  if v_tk.duplicate_of is not null then
    raise exception 'เผยแพร่ได้เฉพาะเรื่องหลัก (ไม่ใช่เรื่องซ้ำ)' using errcode = 'P0001';
  end if;

  v_cat := coalesce(p_category, v_tk.category);

  if p_public then
    -- 0076: an explicit "no" from the submitter is binding. null (legacy /
    -- not asked) stays SE-judgment so pre-0076 tickets behave unchanged.
    if v_tk.public_consent is false then
      raise exception 'ผู้แจ้งไม่ยินยอมให้เผยแพร่เรื่องนี้สู่สาธารณะ' using errcode = 'P0001';
    end if;
    if v_cat is null then
      raise exception 'ต้องระบุหมวดหมู่ก่อนเผยแพร่' using errcode = 'P0001';
    end if;
    select is_confidential into v_conf from public.vs_categories where id = v_cat;
    if coalesce(v_conf, true) then
      raise exception 'หมวดหมู่นี้เป็นความลับ ไม่สามารถเผยแพร่สู่สาธารณะได้' using errcode = 'P0001';
    end if;
    if btrim(coalesce(p_title, '')) = '' then
      raise exception 'ต้องระบุหัวข้อสาธารณะก่อนเผยแพร่' using errcode = 'P0001';
    end if;
  end if;

  update public.vs_tickets
     set category    = v_cat,
         is_public   = p_public,
         public_title = case when p_public then btrim(p_title) else public_title end,
         public_note  = case when p_note is not null then btrim(p_note) else public_note end
   where id = p_id;
end;
$$;

revoke all on function public.vs_set_public(text, boolean, text, text, text) from public, anon;
grant execute on function public.vs_set_public(text, boolean, text, text, text) to authenticated;

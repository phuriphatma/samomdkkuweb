-- ============================================================
-- 0003 — Storage bucket for image uploads
--
-- Creates a public-read bucket "samo-uploads" used by:
--   - Quill image handler (announcement / VS editors)
--   - Creator announcement thumbnail picker
--   - PR form file uploads
--
-- Public reads so the URLs embed in <img> tags without authentication.
-- Inserts only allowed for authenticated users.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('samo-uploads', 'samo-uploads', true)
on conflict (id) do update set public = excluded.public;

-- Allow public read access. The bucket itself is set public above, but
-- explicit policies are still required for some clients.
drop policy if exists "samo-uploads public read" on storage.objects;
create policy "samo-uploads public read" on storage.objects
  for select using (bucket_id = 'samo-uploads');

-- Authenticated users can upload to this bucket.
drop policy if exists "samo-uploads authenticated insert" on storage.objects;
create policy "samo-uploads authenticated insert" on storage.objects
  for insert with check (
    bucket_id = 'samo-uploads' and auth.role() = 'authenticated'
  );

-- Object owners (uploaders) can update their own objects.
drop policy if exists "samo-uploads owner update" on storage.objects;
create policy "samo-uploads owner update" on storage.objects
  for update using (bucket_id = 'samo-uploads' and owner = auth.uid());

-- Staff/dev can delete any object in the bucket (for cleanup).
drop policy if exists "samo-uploads staff delete" on storage.objects;
create policy "samo-uploads staff delete" on storage.objects
  for delete using (
    bucket_id = 'samo-uploads'
    and (auth.uid() = owner or public.current_user_is_staff())
  );

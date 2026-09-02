-- ============================================================
-- 0179 — a ฝ่าย page can have SECTIONS and plain TEXT, not just cards
--
-- REPORTED, by the owner, of the หน้าฝ่าย editor 0177 shipped:
--   "the current is having to fill in each card then it'll appear on ui.
--    i think it's too bland, like there isn't many component for user to can
--    do it, they can't position where they want, it's hard to use not like
--    wyswyg … i want it to be like this web [KKU Moodle], my university can
--    have professor who isn't so much technical to adjust the e-learning page
--    for their subject to put what ever they want"
--
-- WHY THIS SHAPE, AND NOT A CANVAS. The reference the owner chose is evidence
-- about the answer. A Moodle course page is NOT free positioning and is not
-- WYSIWYG: it is an ordered list of TYPED items grouped under SECTION headings
-- (DX02, DX03, DX04), each edited through a form. That is the same model
-- dept_content already has. What separates the two is VOCABULARY, not
-- architecture — Moodle has sections and ~20 item types; 0177 shipped a flat
-- run of exactly two.
--
-- Every mainstream editor aimed at a non-technical author is this same shape:
-- an ordered list of typed blocks. WordPress Gutenberg, Notion, Ghost,
-- Confluence. The free-position canvases (Webflow, Framer, Wix) are aimed at
-- designers, and in non-designer hands they reliably produce a page that only
-- works at the width its author happened to use. Most of this site's traffic
-- is phones, so a canvas would trade the owner's bottleneck for a worse one.
--
-- So this migration widens the vocabulary and changes nothing else.
--
--   kind='section' — a heading that groups everything after it, with an
--                    optional line of summary underneath. This is the single
--                    biggest visual difference from the screenshot: a page of
--                    twelve undifferentiated cards becomes three named groups.
--   kind='text'    — a paragraph, full width, no card chrome. The missing
--                    middle. Before this, a ฝ่าย that wanted two sentences of
--                    explanation had to jump from "fill in a form" straight to
--                    "write HTML", and that cliff is most of what "not many
--                    components" means.
--
-- ADD ONLY — no column is dropped or narrowed, and the two existing kinds are
-- untouched. Safe in either order against a running app (skills/ship-a-migration.md):
-- old code cannot create a row of a new kind because the button does not exist
-- in it, and were one to exist anyway, renderDeptContent's else-branch draws it
-- as a static card — wrong-looking, never broken.
-- ============================================================

-- The body rule, restated whole. A row must carry what its kind RENDERS, or it
-- is an invisible blank on a public page that nobody can explain — the reason
-- the original constraint exists, now extended rather than relaxed.
--
-- ⚠️ Restated, not amended: dropping and recreating means the FULL predicate is
-- visible in this diff. A migration that adds one `or` to a constraint it does
-- not show leaves the reader believing whatever they last read.
alter table public.dept_content
  drop constraint if exists dept_content_has_body;

alter table public.dept_content
  add constraint dept_content_has_body check (
       (kind = 'card'    and title       is not null and length(btrim(title))       > 0)
    or (kind = 'html'    and html        is not null and length(btrim(html))        > 0)
    or (kind = 'section' and title       is not null and length(btrim(title))       > 0)
    or (kind = 'text'    and description is not null and length(btrim(description)) > 0)
  );

-- The kind list. Same treatment: recreated in full so the diff shows every
-- value that is legal, instead of implying the set from one added name.
alter table public.dept_content
  drop constraint if exists dept_content_kind_check;

alter table public.dept_content
  add constraint dept_content_kind_check
  check (kind in ('card', 'html', 'section', 'text'));

comment on column public.dept_content.kind is
  'card = a link tile in a grid · section = a heading that groups what follows '
  '· text = a full-width paragraph · html = the ฝ่าย''s own markup, rendered in '
  'a sandboxed opaque-origin frame and deliberately NOT sanitised (0177). '
  'Adding a kind means teaching renderDeptContent about it — an unknown kind '
  'falls through to the card branch.';

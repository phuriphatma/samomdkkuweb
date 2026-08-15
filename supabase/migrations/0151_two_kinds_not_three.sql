-- 0151 — a node is a ฝ่าย or a ตำแหน่ง. There is no third thing.
--
-- REQUESTED (2026-08-15): "I think ฝ่าย (Division) แผนก (Department) ตำแหน่ง
-- (Role) should be left only ฝ่าย and ตำแหน่ง".
--
-- WHY THE MIDDLE ONE NEVER EARNED ITS PLACE. Measured on the live tree before
-- this migration: 205 role · 78 department · 15 division. Every single one of
-- the 78 is a CONTAINER, and 74 of them are literally NAMED "ฝ่าย …"
-- ("ฝ่าย PR (Public relations & creative media)", "ฝ่าย AMSA", …). The four
-- that are not — "Project director of AMSA-KKU", "รพ. ขอนแก่น",
-- "รพ. มหาสารคาม", "รพ. อุดรธานี" — each hold ตำแหน่ง children and nothing
-- else, so they are units too. Not one row is a genuine third category.
--
-- And nothing read the value. `kind` picked an icon in the admin sidebar; no
-- policy, no RPC, no public renderer branched on it. A vocabulary word that
-- decides nothing and that half the tree disagrees about how to use is pure
-- cost at data-entry time.
--
-- It decides something NOW: the public chart orders a ฝ่าย's own ตำแหน่ง above
-- its sub-ฝ่าย, and the "แสดงถึง" rungs are ฝ่ายหลัก / ฝ่ายย่อย / ตำแหน่ง /
-- ทั้งหมด rather than raw depth. Both of those need to know which of the two a
-- node is — which is exactly why the ambiguous third value had to go first.
--
-- ORDERING. This is a value rewrite, not a DROP: `kind` is plain `text` with no
-- check constraint, so no served bundle can 400 on it, and the shipping code
-- folds a stray `department` into ฝ่าย on read anyway (src/js/node-kind.js).
-- Safe to apply before or after the deploy. The CHECK constraint that would
-- make `department` unwritable is deliberately NOT here — the currently served
-- bundle still writes it from the CSV path importer, and adding the constraint
-- first would 23514 that importer mid-run. It comes in a follow-up, after the
-- new bundle is confirmed served.
--
-- The archive is rewritten too. A frozen year keeps its people and its shape;
-- `kind` is presentation, and leaving 2024 rendering under different ordering
-- rules from 2025 would be a bug the reader cannot explain.

update public.team_nodes
   set kind = 'division'
 where kind = 'department';

update public.team_archive_nodes
   set kind = 'division'
 where kind = 'department';

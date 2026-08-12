# Design — managing roles & permissions, and getting faces onto เกี่ยวกับเรา

Status (corrected 2026-08-12): **PART A is still unbuilt; most of PART B
SHIPPED.** Written 2026-08-04 against the live DB, and half of it has since been
overtaken — read it knowing which half.

- **PART A (roles, permissions, audit): still a proposal.** Verified — no
  `team_grant_log` table exists in `supabase/migrations/` or in `src/`, and
  there is no recertification or role-template machinery.
- **PART B (photos): largely done.** Portraits live on the person
  (`people.photo_url`, migration 0132+), self-service upload exists on the
  member's own card (`src/js/my-seat.js`), replaced files are cleaned out of
  Drive (`photoToRetire()` + `photo-retire.test.js`), and a refcount decides
  whether a file is still referenced (0143/0146). Consent-as-a-record (B2) and
  the coverage dashboard (B5) were NOT built.
Supersedes nothing; extends the model in `docs/CONTEXT.md` and the hard rules in
`.claude/rules/mistakes.md`.

Two problems that look separate and are not. Both are the same shape: **the
system can express the right answer, but no one can see what the current answer
is, and no one is being asked for the input it needs.**

---

## 0. Where we actually are (measured 2026-08-04, live DB)

| | |
|---|---|
| `team_members` rows / distinct people (`team_people`) | 404 / 303 |
| Members with a portrait | **1** |
| คณะกรรมการ grid: slots / with a portrait | **11 / 0** |
| Board members who have a kkumail | 11 / 11 |
| Nodes carrying a grant / members carrying a grant | 10 / 4 |
| People with ANY admin access | 27 |
| …of whom can grant permissions (`team`) | **15** |
| …with blanket `vs` (every department's confidential tickets) | 3 |

Read those three bold numbers together and the diagnosis writes itself.

**The public board is eleven monograms.** The photo pipeline is finished and
good — crop to 3:4, lh3 server-side crop, refcounted Drive delete, archive
snapshots — and it has been used once, because the only door into it is *an
admin opening a modal and uploading a file they do not have*. Nobody has the
eleven photos. There is no mechanism to ask for them.

**Fifteen of twenty-seven admin users can grant themselves anything.** Not by
mistake — `อุปนายกฯ` carries `{team}` and inheritance carries it down the whole
branch. `team` is the permission that governs the permission engine, so its
holders are unbounded. Nobody chose this; it is the arithmetic of one checkbox
on one node.

**One live mis-grant, visible in the data:** `หัวหน้าฝ่าย IT` holds
`project_seat = 'prof'`. That means: signs หนังสือ as อาจารย์, and sees only
documents sent to them for signature. The IT lead is not a professor. The grant
UI said `☑ หนังสือโครงการ` + a dropdown; it never said *"คนนี้จะลงนามหนังสือใน
ฐานะอาจารย์"*. That sentence is most of Part A.

---

## 1. What professionals actually do (only the parts that apply here)

Enterprise IAM (Okta, Azure AD, Google Workspace) and the tools students'
future employers use converge on five habits. Ranked by value **at this org's
size** — 14 grant sites, 27 admin users — not by how impressive they sound:

1. **Say what the grant lets them DO**, in the product's own words, at the
   moment of granting. Slack, Notion and GitHub all describe roles in
   sentences, never in permission keys.
2. **An inverse view.** Every IAM console can answer "who can do X?" — not just
   "what can this person do?". Ours cannot, at all.
3. **An audit log.** Immutable, who/what/when. Non-negotiable everywhere.
4. **Least privilege for the admin permission itself**, and separation of duty
   (you cannot grant yourself).
5. **Periodic recertification** — quarterly at companies; here, once per
   ปีการศึกษา, which the term/publish flow already gives us for free.

Role *templates* ("assign the job, not the checkboxes") is the sixth habit and
the one everyone reaches for first. **Deliberately ranked last here.** With ten
nodes and four members holding grants, a template CRUD is more surface than the
problem. Sentences (#1) deliver most of its benefit for a tenth of the code.
Revisit when grant sites pass ~40.

For photos, the pattern in every HR directory (Workday, BambooHR, Personio) is
the same three moves: **the person uploads their own**, **consent is recorded
as data**, and **a coverage dashboard exists so someone can chase the gaps**.
We have none of the three.

---

## PART A — roles & permissions

### A1. Say what the grant DOES, in Thai, before it is saved

The one change that would have caught the `prof` mis-grant.

Every grant surface — the node modal, the person modal, the row chips, the save
confirmation — renders **capability sentences** derived from the resolved grant,
never raw keys.

```
┌ สิทธิ์การใช้งานระบบ — หัวหน้าฝ่าย IT ────────────────────┐
│  ☑ PR      ☑ VitalSound   ☑ SAMO Shop   ☑ หนังสือโครงการ │
│  ☑ เขียนประกาศ   ☑ ทีม SAMO   ☐ SAMO Passport            │
│                                                          │
│  ── คนในตำแหน่งนี้จะทำอะไรได้ ────────────────────────── │
│  • รับและจัดการคำขอ PR ทั้งหมด                            │
│  • เห็นและจัดการเรื่องร้องเรียน VitalSound  ทุกแผนก  ⚠   │
│  • จัดการสินค้าและออเดอร์ SAMO Shop                       │
│  • ลงนามหนังสือโครงการในฐานะอาจารย์ ⚠                     │
│    (เห็นเฉพาะหนังสือที่ส่งมาให้ลงนาม — สร้างโครงการไม่ได้)│
│  • เขียนและเผยแพร่ประกาศ                                  │
│  • แก้ไขผังทีม และ ให้สิทธิ์ผู้อื่นได้ ⚠                  │
└──────────────────────────────────────────────────────────┘
```

- ⚠ marks a **wide or unusual** capability: a blanket scope where a narrow one
  exists, or `team.grant`. It is a flag for the human, not a block.
- On save, a **diff**, not a restatement: `จะเพิ่ม: …` / `จะถอด: …`. An admin
  opening a modal to fix one thing must see the other six they are about to
  re-affirm.

**Implementation rule that is not optional.** The sentences are rendered from
the **resolved** grant returned by the server resolvers
(`effective_team_*_for_email`, `node_effective_*`), never re-derived in JS from
the checkbox state. Two implementations of one rule drift — that class has
already bitten this repo repeatedly (`permTicked`, `vs_remark_vis`). One
`CAPABILITY_TEXT` table, one caller, and a differential test if any part of it
is ever computed twice.

### A2. Split `team` — the fix with the highest value per line

`team` today means both *"fix a spelling in the roster"* and *"grant anyone any
permission in the organisation"*. Those are wildly different risks and are
needed by wildly different people. Fifteen holders is the consequence.

| key | grants | needed by |
|---|---|---|
| `team` | จัดการทีม · ปีการศึกษา · ตรวจสอบข้อมูล · photos | เลขาฯ, ฝ่าย IT, anyone maintaining the roster |
| `team.grant` | จัดการสิทธิ์ — the permission engine | นายกฯ + one or two deputies |

Three properties, all enforced **server-side**, because the UI is not the
boundary:

1. **`team.grant` does not inherit.** It is excluded from
   `node_effective_permissions` propagation. Inheritance is precisely how one
   checkbox became fifteen people. A non-inheritable key must be honoured in
   the SQL resolver *and* mirrored in the JS chip renderer — differential test
   in the same commit.
2. **No self-escalation.** A `team.grant` holder may not perform a write that
   widens **their own** effective grant. Enforced in the write path (trigger or
   definer RPC comparing the actor's resolved set before/after), not in the
   modal. Wanting more access is exactly when someone would use DevTools.
3. **Granting `team.grant` is type-to-confirm**, and named in the audit log
   with the actor. The escalating direction gets the stronger confirm — the
   repo's existing rule, applied to the recursive case.

**Migration is the delicate part.** `team.grant` must be seeded to the people
who genuinely need it *before* `team` stops implying it, or the org locks
itself out of its own permission engine. Expand-then-contract:
seed → deploy the UI reading both → flip the gate → verify → remove the
compatibility branch. Never in one migration.

### A3. The inverse view — "ใครมีสิทธิ์อะไร"

A third sub-tab under จัดการสิทธิ์. One RPC, `team_access_register()`, returning
one row per person: email, name, ตำแหน่ง path, **resolved** permissions and
scopes, the source of each (`own` / `inherited from ฝ่าย X`), and
`last_sign_in_at`.

Two groupings, one toggle:

```
── ตามสิทธิ์ ──────────────────────────────────────────────
VitalSound · ทุกแผนก             3 คน  ⚠  [ดู]
VitalSound · เฉพาะแผนก           4 คน     [ดู]
ทีม SAMO (ให้สิทธิ์ผู้อื่นได้)    15 คน  ⚠  [ดู]
หนังสือโครงการ · อาจารย์          2 คน     [ดู]
…
── ตามบุคคล ──────────────────────────────────────────────
พุธิตา สร้อยสุข (พู่กัน)   PR · ประกาศ · ทีม · Passport · VS:ดิจิทัล
   ↳ own: pr, creator, team, passport · vs_dept: ดิจิทัลฯ
   ↳ เข้าสู่ระบบล่าสุด: 3 วันที่แล้ว
```

Two things this makes possible that are impossible today: answering *"who can
read ฝ่ายวิชาการ's confidential complaints?"* without walking 404 rows, and
finding **granted-but-never-signed-in** accounts — dead grants that are pure
risk.

Same rule as A1: the register is computed by the **same resolver functions RLS
uses**. A register that re-implements resolution would eventually reassure you
about access the database does not agree with, which is worse than no register.

### A4. `team_grant_log` — append-only audit

Today "who gave this node blanket VS, and when?" is unanswerable. `updated_at`
is the only trace and it is overwritten by the next drag-reorder.

```sql
create table public.team_grant_log (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  actor_user_id uuid,          -- auth.uid() at write time; null = server/migration
  actor_email   text,
  subject_kind  text not null check (subject_kind in ('node','member')),
  subject_id    uuid not null,
  subject_label text,          -- denormalised: the node/person may later be deleted
  before        jsonb,
  after         jsonb
);
```

Non-obvious requirements, each earned by an entry in `mistakes.md`:

- **Written by an AFTER trigger on `team_nodes` / `team_members`, not by
  `api.js`.** A direct `PATCH /rest/v1/team_nodes` is exactly the write worth
  logging; app-side logging misses it by construction.
- **Fires only when a GRANT column changes** — `permissions`,
  `inherit_permissions`, `vs_dept`, `project_seat`, `passport_dept_id`. Not on
  `position`: one drag rewrites dozens of rows and would bury the signal.
- **`subject_label` is denormalised** so a deleted node's history stays
  readable.
- **Size-capped + pruned**, like `notify_log` (0055): `char_length` CHECKs plus
  a security-definer `prune_team_grant_log(retain_days)` **not** granted to
  anon/authenticated.
- Read gated on `team.grant` **and** on `current_user_is_staff()` — repointed
  per-policy, never by widening `current_user_is_staff()` itself, which
  `users_self_update_guard` also trusts.
- No UPDATE or DELETE policy at all. Append-only means append-only.

UI: a "ประวัติการให้สิทธิ์" list in จัดการสิทธิ์, and a per-node/per-person
"ประวัติ" link in each modal showing that subject's history inline. Rendering
must `escHtml` every field — `subject_label` originates in user-typed text.

### A5. Recertification, once per ปีการศึกษา

The term rollover already exists and is exactly the moment the roster turns
over. On publishing a new term, จัดการสิทธิ์ shows a banner until reviewed:

```
┌ ทบทวนสิทธิ์ประจำปีการศึกษา 2569 ─────────────────────────┐
│ 27 คนมีสิทธิ์เข้าใช้ระบบหลังบ้าน · ทบทวนแล้ว 0/27        │
│ [ เริ่มทบทวน ]                          ยังไม่ได้ทบทวน   │
└──────────────────────────────────────────────────────────┘
```

Row per grant → เก็บไว้ / ถอด, stamped into
`team_grant_reviews(year, reviewed_by, reviewed_at, decisions jsonb)`. Cheap to
build, and it is the only thing that removes access nobody remembers granting.

Feed it from ตรวจสอบข้อมูล, which already exists as a findings pane — add a
"สิทธิ์" section: granted-but-never-signed-in · blanket scope where a narrow one
exists · grant on a ตำแหน่ง with no members · grant on a non-public node.

### A6. Role templates — recommended, phase last

`team_role_templates(name, description, permissions[], vs_scope, project_seat,
passport_dept_id, position, is_active)`. The perm modal becomes *pick a job*
first (cards with the A1 sentences), *"ปรับแต่งเอง"* second.

**Assignment COPIES the values onto the node/member; it does not reference the
template.** A live reference means editing a template silently re-grants across
the org — the exact invisible-broad-grant shape this repo keeps getting bitten
by. Store `granted_from_template` for display and show a drift prompt instead:
*"แม่แบบ 'ผู้ดูแล PR' เปลี่ยนไปแล้ว — อัปเดต 4 ตำแหน่งที่ใช้แม่แบบนี้?"*.
Explicit, reviewable, and it keeps the audit log meaningful.

---

## PART B — photos on เกี่ยวกับเรา

### B0. The actual problem

Not the crop. Not the CDN. **Nobody has ever been asked for a photo, and there
is no way to ask.** Eleven board members, eleven kkumail addresses, zero
photos, and an upload flow that only an admin can reach.

Every design decision below serves one goal: *the eleven people upload their
own photo, and the admin's job becomes chasing a number, not collecting files.*

### B1. The portrait belongs to the PERSON

Part of the 0108 contract step. `photo_url` / `photo_focus` move to
`team_people`; `team_members` reads through `person_id`.

Today someone holding three ตำแหน่ง is three rows and needs three uploads, and
can look different in each. After 0108's contract step they are one person with
one portrait — and next year's import matches them instead of creating a
stranger who must re-upload.

Transition: the public projection reads `coalesce(p.photo_url, m.photo_url)`
until the columns are dropped. **`team_archive_members` keeps its own snapshot
copy** — an archived year must not silently change when someone updates their
photo. (Consent is handled differently; see B6.)

### B2. Consent is a record, not a sentence in a form hint

Today the only consent is admin-facing hint text: *"ใช้รูปที่เจ้าตัวยินยอมให้
เผยแพร่"*. For ~30 students' faces on a page open to the public internet, under
Thailand's PDPA, that is not a lawful basis — it is a note to the uploader.

```sql
alter table public.team_people
  add column photo_consent_at   timestamptz,
  add column photo_consent_by   text,   -- 'self' | the admin's email
  add column photo_consent_text text;   -- the EXACT wording agreed to
```

**Publication predicate, in `get_public_team_chart` only:**

```sql
case when p.photo_consent_at is not null then p.photo_url else null end
```

- **Fails closed.** A portrait with no consent record publishes as the monogram.
  The one existing photo therefore needs an explicit decision (see §5) — do not
  auto-consent it in a migration.
- **Store the wording, not a boolean.** The wording will be revised; a boolean
  cannot tell you what someone actually agreed to. That is the whole difference
  between a record and a checkbox.
- Consent is about **publication**, not about the file existing. Admin-side the
  portrait stays visible in ทีม SAMO either way.

### B3. Self-service upload — the member profile page

The direction STATE.md already decided (request-form → approval queue for
people not on the roster; self-uploaded photos go live without moderation).
This is the photo half of that page.

```
/me   (public SPA · sign in with Google · kkumail matched to team_people)

┌──────────────────────────────────────────────────────────┐
│   ┌────────┐   ณัฐธิดา เบญจปิยะพร (นัท)                   │
│   │        │   อุปนายกฝ่ายกิจการภายนอก                     │
│   │  รูป   │   natbenja@kkumail.com                        │
│   │  3:4   │                                              │
│   └────────┘   [ อัปโหลดรูป ]  [ นำรูปออก ]                │
│                                                          │
│   ⚠ รูปของคุณยังไม่แสดงบนหน้าเว็บ                          │
│      ต้องกดยินยอมเผยแพร่ก่อน                              │
└──────────────────────────────────────────────────────────┘
```

Upload → the existing 3:4 crop dialog → then, on the same screen:

```
┌ ยืนยันการเผยแพร่ ────────────────────────────────────────┐
│   [preview of the EXACT card as it will appear]           │
│                                                          │
│   ☐ ข้าพเจ้ายินยอมให้เผยแพร่รูปนี้พร้อมชื่อและตำแหน่ง      │
│     บนหน้า “เกี่ยวกับเรา” ของเว็บไซต์สโมสรนักศึกษาฯ        │
│     ซึ่งบุคคลทั่วไปเข้าดูได้ และสามารถถอนความยินยอม        │
│     ได้ทุกเมื่อจากหน้านี้                                  │
│                                    [ บันทึกและเผยแพร่ ]   │
└──────────────────────────────────────────────────────────┘
```

- Checkbox **unticked by default**; the button is disabled until ticked. The
  escalating direction is never the default — the repo's rule, applied to
  publication.
- The exact string above is written into `photo_consent_text`.
- **ถอนความยินยอม** is on the same page, one tap, no confirmation theatre. A
  withdrawal that is harder than the grant is not a real withdrawal.

**Security, from the top of `mistakes.md`:** self-edit goes through a
`SECURITY DEFINER` RPC with a **column allow-list**. Never
`for update using (user_id = auth.uid())` — that shape has already been
exploited on `users` (0028), `vs_tickets` (0096) and `shop_orders` (0100), and
here it would let a member set their own `permissions`.

### B4. The collection campaign — the operational unlock

Admin selects a group (คณะกรรมการ, one ฝ่าย, or hand-picked) → **"ขอรูปจากคน
กลุ่มนี้"** → the app produces a ready-to-paste Thai message + link + QR:

```
สวัสดีค่ะ ขอรบกวนอัปโหลดรูปประจำตัวสำหรับหน้าเว็บสโมฯ
เข้าที่ https://samo.md.kku.ac.th/me แล้วเข้าสู่ระบบด้วย kkumail
ใช้เวลาประมาณ 1 นาที · ปิดรับ 15 ส.ค.
```

**The link carries no token.** It is just `/me`; Google login *is* the
identification, and their kkumail is already in `team_people`. So one message
serves the whole group, it can be forwarded safely, there is nothing to expire
or leak, and no magic-link machinery gets built. Pasted into LINE, which is how
this org actually communicates.

### B5. Coverage — an admin chases a number, not files

In ทีม SAMO, above the tree, and again as a section in ตรวจสอบข้อมูล:

```
┌ รูปประจำตัว ─────────────────────────────────────────────┐
│  คณะกรรมการ    ▓▓▓▓▓▓░░░░░░░░░░  4/11        [ขอรูป]     │
│  ทั้งองค์กร     ▓░░░░░░░░░░░░░░░  12/303      [ขอรูป]     │
│                                                          │
│  • 7 คน ยังไม่มีรูป                              [ดู]    │
│  • 2 คน มีรูปแต่ยังไม่ยินยอมเผยแพร่               [ดู]    │
│  • 1 รูป ความละเอียดต่ำกว่ามาตรฐาน                [ดู]    │
│  • 3 รูป อัปโหลดใหม่ใน 7 วันที่ผ่านมา             [ดู]    │
└──────────────────────────────────────────────────────────┘
```

Every row filters the existing findings pane — same pattern as the ตรวจสอบข้อมูล
flags, which already carry *which* row was clicked into the filtered view.

"อัปโหลดใหม่ใน 7 วัน" is what makes **no moderation** safe: publication is
instant (fast, respectful of the uploader), and an admin still gets one place to
eyeball what appeared. Paired with a one-tap admin **"ซ่อนรูปนี้"** that clears
`photo_consent_at` — unpublish, never delete; deletion stays the refcounted
path in `team/api.js`.

### B6. Withdrawal, archives, and the shoot

- **Withdrawal hides the face everywhere, including archived years.**
  `get_public_team_chart` gates on the **person's current consent** even when
  serving an archived snapshot. The archive keeps the bytes (it is a record for
  admins); the public page honours the withdrawal. A "historical record"
  exception to a PDPA withdrawal is not one this org needs to defend.
- **Photo spec at the point of upload** — three bullets and a good/bad example,
  the way HR tools do it: ครึ่งตัว · พื้นหลังเรียบ · แสงสว่างพอ · ไม่ใส่หมวก/แว่นกันแดด.
  Warn (do not block) below 520×693, or the card upscales and looks mushy.
- **A light oval face guide in the crop frame.** Cheap, and it is the single
  biggest driver of a grid that looks composed rather than assembled.
- **Keep the monogram fallback.** A dignified, tinted, consistent placeholder is
  better than omitting the card, and a visibly incomplete grid is exactly the
  social pressure that gets the last four photos in.
- If the org would rather shoot all eleven in one session — do that, and the
  admin uploads on their behalf with `photo_consent_by = <admin email>` and a
  consent text recording that it was given at the shoot. Same record, same
  predicate, no special path.

---

## 4. Build order

Each phase is independently shippable and independently useful.

| # | Phase | Size | Why here |
|---|---|---|---|
| 1 | Split `team` / `team.grant`, non-inheritable, no self-escalation | ½–1 d | Highest risk reduction per line. 15 → ~3 holders. No new UI surface. |
| 2 | `team_grant_log` + trigger + "ประวัติการให้สิทธิ์" | 1 d | Do it before phase 1's re-grants, so the cleanup is itself recorded. |
| 3 | Capability sentences + save-diff (A1) | 1 d | No schema. Catches the `prof` class of mis-grant. |
| 4 | `team_access_register()` + ใครมีสิทธิ์อะไร (A3) | 1–2 d | First time "who can do X" is answerable. |
| 5 | Photos + consent on `team_people`, projection gate, admin ซ่อนรูป | 2 d | Unblocks phase 6; also completes 0108's contract step. |
| 6 | `/me` self-upload + consent + campaign + coverage (B3–B5) | 2–3 d | **The one that turns 0/11 into 11/11.** |
| 7 | Recertification (A5) · role templates (A6) | 2 d | Once the roster turns over, and once grant sites pass ~40. |

Phases 2 → 1 order is deliberate: the audit log should be watching when the
`team` split rewrites fifteen people's access.

---

## 5. Decisions the user needs to make

1. **Split `team` into `team` + `team.grant`?** *Recommend yes.* It is the
   difference between 15 and ~3 people who can grant themselves anything.
   Who should hold `team.grant` — นายกฯ only, or นายกฯ + ฝ่าย IT?
2. **Does withdrawing consent hide the face in ARCHIVED years too?**
   *Recommend yes* (design assumes it).
3. **The one existing photo** — ask that person for consent, or treat it as
   already consented? *Recommend ask*; it is one message, and it sets the norm.
4. **Self-uploaded photos go live with no moderation** — STATE.md decided this.
   *Recommend keeping it*, now that consent is recorded and the 7-day review
   list plus one-tap ซ่อนรูป exist as the backstop. Confirm it still holds.
5. **`หัวหน้าฝ่าย IT` has `project_seat = 'prof'`** — fix now (independent of
   all of the above), or is it intentional?

---

## 6. Traps that apply — do not rediscover these

Each is already an entry in `.claude/rules/mistakes.md`.

- **A permission channel has four halves: writes · reads · audience lookups ·
  definer-RPC guards.** `team.grant` must be threaded through every gate `team`
  currently passes. Sweep `pg_policies` and `pg_get_functiondef` for
  `current_user_has_permission('team')`, and test the OPERATION, not the
  predicate.
- **A narrowing dimension added beside an unconditional grant is dead** —
  permissive policies are OR'd. If `team` keeps implying `team.grant` anywhere,
  the split is decorative.
- **Never widen `current_user_is_staff()`** to make a new read work;
  `users_self_update_guard` trusts it. Repoint policies individually.
- **`for update using (<col> = auth.uid())` is a row filter, never a column
  policy.** The `/me` self-edit is a definer RPC with an allow-list, full stop.
- **`create or replace function` cannot change a return type**, and the
  migrations directory is an append-only log — diff against the LIVE body
  (`pg_get_functiondef`) before rewriting any resolver, or you will silently
  revert a later migration.
- **A public projection is an explicit `jsonb_build_object`**, never
  `select *` / `returns setof <table>`. Every column added to `team_people`
  is exposed by default if that discipline slips.
- **Two implementations of one rule drift** — capability sentences, the register
  and the chip renderer must all read the same resolver. Differential test in
  the same commit.
- **Allow-lists feeding a BACKUP have the opposite safe default from one
  feeding a projection.** `buildExportJson` / `importJson` must carry
  `photo_consent_*`, or a restore silently unpublishes everyone.

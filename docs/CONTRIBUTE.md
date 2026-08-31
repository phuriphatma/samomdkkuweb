# ช่วยพัฒนาเว็บสโมฯ — how to contribute

**หน้านี้เขียนให้ทุกคนอ่านได้** ไม่ว่าจะเคยเขียนโปรแกรมหรือไม่ ส่วนแรกคือสิ่งที่ทุกคนต้องรู้
ส่วนท้ายคือรายละเอียดสำหรับคนที่เขียนโค้ด — อ่านเท่าที่ต้องใช้ แล้วหยุดได้เลย

> **This page is written for everyone.** The first half is what anyone needs;
> the developer detail is layered underneath. Read until it stops being useful
> to you, then stop.

> 👉 **อยากได้คู่มือแบบทีละคำสั่ง** ตั้งแต่เปิด Terminal จนถึง PR ถูกรวม พร้อมรูป
> — อ่าน **[ทีละขั้น · Step by step](/STEP-BY-STEP)**
> หน้านี้ตอบว่า *แก้อะไรได้ กฎคืออะไร* หน้านั้นตอบว่า *มือต้องพิมพ์อะไร*

---

## 1. คุณไม่ต้องขอสิทธิ์อะไรเลย

**เข้าใจผิดกันบ่อยที่สุด: คุณไม่ต้องให้ใครเพิ่มคุณเข้าโปรเจกต์ก่อน**

ทุกคนที่มีบัญชี GitHub สามารถเสนอการแก้ไขได้ทันที — ระบบจะสร้าง "สำเนาของคุณเอง" ให้
คุณแก้ในสำเนานั้น แล้วส่งกลับมาให้ทีมตรวจ ของจริงไม่เปลี่ยนจนกว่าจะมีคนกดรับ

**ไม่มีทางที่คุณจะทำเว็บพังโดยไม่ตั้งใจ** เพราะการแก้ของคุณต้องผ่านการตรวจก่อนเสมอ

## 2. อะไรที่แก้ได้บ้าง

| อยากทำอะไร | ยากแค่ไหน |
|---|---|
| แก้คำผิด แก้ข้อความ | พิมพ์แก้ในเว็บ GitHub ได้เลย ไม่ต้องลงโปรแกรมอะไร |
| เพิ่ม/แก้หน้าเครื่องมือของฝ่ายตัวเอง | ต้องแก้ไฟล์ HTML — มีตัวอย่างให้ดู ([DEPT-TOOLS](/DEPT-TOOLS)) |
| แก้หน้าตา สี ระยะห่าง | ต้องแก้ CSS |
| แก้ระบบล็อกอิน ฐานข้อมูล การแจ้งเตือน | ต้องคุยกับทีม IT ก่อน — ดู §6 |

## 3. ขั้นตอน — 5 ขั้น

1. **เปิดหน้าที่อยากแก้บน GitHub** แล้วกดรูปดินสอ ✏️
2. **แก้ข้อความ** GitHub จะสร้างสำเนาของคุณให้อัตโนมัติ
3. **กด "Propose changes"** แล้วเขียนสั้น ๆ ว่าแก้อะไร ทำไม
4. **กด "Create pull request"** — คำว่า *pull request* แปลว่า "ขอให้ดึงการแก้ของฉันเข้าไป"
5. **รอทีมตรวจ** มีคนอ่าน ถามได้ ตอบได้ แก้เพิ่มได้

> 📌 **ทุกครั้งที่คุณส่ง ระบบจะสร้างเว็บทดลองให้อัตโนมัติ** พร้อมลิงก์ในหน้า pull
> request ของคุณ — เปิดดูได้ว่าการแก้ของคุณหน้าตาเป็นยังไงจริง ๆ ก่อนใครกดรับ
> เว็บทดลองต่อกับ **ฐานข้อมูลสำเนา ไม่ใช่ของจริง** จึงกดปุ่ม ส่งฟอร์ม ลองได้เต็มที่

## 4. กฎที่ห้ามพลาด

⛔ **ห้ามใส่ข้อมูลจริงของนักศึกษาลงในโค้ด** — ชื่อ รหัสนักศึกษา อีเมล รูปถ่าย
ทั้งในไฟล์ ในข้อความ commit และในภาพหน้าจอ

**เพราะโปรเจกต์นี้เปิดสาธารณะ** ใครก็เข้ามาอ่านได้ และประวัติของ Git ลบไม่ได้จริง —
ลบวันนี้ พรุ่งนี้ก็ยังย้อนดูได้ ถ้าต้องใช้ตัวอย่าง ให้สมมติชื่อขึ้นมา

## 5. หลังจากส่งแล้วเกิดอะไรขึ้น

1. ระบบตรวจอัตโนมัติว่าโค้ดยังทำงานได้ (ใช้เวลาไม่กี่นาที)
2. สร้างเว็บทดลองให้ดู
3. มีคนในทีมอ่านและตอบ
4. เมื่อผ่าน — รวมเข้า `main`
5. **การรวมเข้า `main` ยังไม่ขึ้นเว็บจริง** ผู้ดูแลต้องสั่ง deploy อีกครั้ง

---

# สำหรับคนที่เขียนโค้ด · Developer detail

ทุกอย่างข้างบนยังใช้ได้เหมือนเดิม ส่วนนี้คือรายละเอียดเพิ่ม

## 6. Touch zones — what needs a review first

Self-merge is fine for HTML/CSS/copy and per-feature form modules. **Ask before
touching** anything in this list, because a mistake there is not visible in
review:

| Path | Why |
|---|---|
| `src/js/auth.js` | Supabase auth has known sharp edges — `docs/mistakes/supabase-client.md` |
| `src/js/db.js` | Client config + `dbRest`, load-bearing |
| `src/js/notify.js` | Discord proxy — wrong here is a silent prod outage |
| `src/js/uploads.js` | The Drive upload contract with Apps Script |
| `supabase/migrations/*.sql` | The schema is the source of truth for the live DB |
| `appscript/*.gs` | Webhook URLs live here; a redeploy hits prod immediately |
| Any new `innerHTML` with user text | Run it through `escHtml()` first — XSS |
| Any new `db.from().update/delete/insert` | Use `dbRest()` with `prefer:'return=representation'` — RLS returns zero rows, not an error |

`.github/CODEOWNERS` enforces this: those paths **block** on a code-owner review,
and CI must pass before anything merges.

## 7. Running it locally

```bash
npm ci
npm run dev          # :5174
npm test             # the suite; CI runs this on every PR
npm run preview:url  # where your branch's preview lives
```

Point `.env.local` at **`samo-dev`**, the development database — a full copy of
production on a separate account. Ask the owner for the `SUPABASE_DEV_*` block.
That is also what every per-PR preview is pointed at, which is why a preview is
safe to click and submit forms on.

⚠️ **`samo-dev` holds REAL student data** (a deliberate decision — it is a copy,
not a fake). Do not publish its URL, and §4 above applies to it exactly as it
applies to production.

**The keystroke-by-keystroke version — installing Node, `gh auth login`, the
first clone — is [ทีละขั้น · Step by step](/STEP-BY-STEP) §0.** It is not
repeated here on purpose.

## 8. Before you open the PR

The checklist lives once, in [Step by step](/STEP-BY-STEP), step 10.
Two items on it are policy rather than procedure, so they are stated here too —
they are the reason this project's documentation is worth anything:

- **If you fixed a bug, write it up** in the matching `docs/mistakes/*.md`:
  symptom → cause → fix → the general rule. These write-ups are the reason the
  same bug rarely lands twice, and the symptom line **as it was reported** is
  what the next person greps for
- **If a person would notice the change**, add a plain-Thai line to `PENDING` in
  `src/data/changelog.js`, in the same commit that ships it — not at release
  time, when what made the change worth having is already forgotten

## 9. Branch model

`main` is the only long-lived branch. (`refactor/modular` was merged long ago;
`docs/MERGE-CHECKLIST.md` is kept as history.) Branches are short-lived, one
topic each, squash-merged.

**A branch is mandatory** — `main` is protected, so a direct push is refused.
Naming, the commands, and what to do when one feature depends on another that
is still in review: [Step by step §2 and §8](/STEP-BY-STEP).

## 10. ฝ่าย tool contributions

**One workflow for everybody** — a ฝ่าย member uses this same pipeline
unchanged. `.github/CODEOWNERS` carries the whole difference:

| Path | Approval needed |
|---|---|
| `public/embed/**` — a page in the sandbox frame | any collaborator |
| `src/data/tools.js` · `src/tools/` · `src/js/data/` | the owner |

`skills/onboard-a-contributor.md` is the 45-minute session that takes someone
from nothing to a merged PR. Design and decisions: [DEPT-TOOLS](/DEPT-TOOLS).

## 11. Live proofs — `npm run proofs`

Some invariants exist only in the database: RLS policies, SECURITY DEFINER
functions, column guards. Those are checked by SQL/Node proofs that run against
the real project **inside a rolled-back transaction**.

**Run it if you touched a migration, a policy, or a definer function.** It needs
`SUPABASE_ACCESS_TOKEN`, so CI does not run it — a maintainer does, before
deploying. Output it cannot interpret is reported as UNKNOWN and exits non-zero,
so a green line really is green.

## 12. Need help?

- Ping Phuri in Discord, or open a **draft PR** with `[help]` in the title.
- For anything in the §6 "ask first" list, write a one-paragraph description in
  the PR body — what you want to change and why — **before** writing code. Much
  faster than re-doing the work afterwards.

## 13. Where everything else is

| You want | Read |
|---|---|
| The commands, in order, with pictures | [ทีละขั้น · Step by step](/STEP-BY-STEP) |
| The rules that must not be broken | [INVARIANTS](/INVARIANTS) |
| How the system is put together | [CONTEXT](/CONTEXT) |
| Shipping a tool for your ฝ่าย | [DEPT-TOOLS](/DEPT-TOOLS) |
| Has this bug happened before? | [the write-up index](/mistakes/INDEX) |
| What is true right now | [`STATE.md`](https://github.com/phuriphatma/samomdkkuweb/blob/main/STATE.md) at the repo root |

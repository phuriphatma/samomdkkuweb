# Onboarding a ฝ่าย contributor — the 45-minute session

Written 2026-08-27, before the first session, so the SECOND one costs the owner
nothing. Design: `docs/DEPT-TOOLS.md`.

**Do this in person, at their laptop, once. It ends when they have MERGED a
pull request that changes one word.** A person who has merged one will open a
second; a person handed a document will not.

⚠️ **Onboard TWO people, not one.** SAMO turns over every year and medical
students disappear into ward rotations without notice. One trained contributor
is a bottleneck with less accountability than IT and no handover — the exact
thing this workflow exists to remove, relocated. Teach the successor **before**
the incumbent leaves.

---

## Before they arrive (owner, 5 min)

- Add them as a repo collaborator with `write` (Settings → Collaborators).
  Not a fork — a fork's pull requests cannot read the repository secrets that
  the preview build needs (`docs/TEAM-WORKFLOW.md` §7.7).
- Confirm they have a GitHub account and know its password.

## On their laptop (35 min)

Everything here is typed by **them**, not by you. That is the point — the muscle
memory is the deliverable.

1. **Node 22.** `node -v`. Node 20 hard-throws on this repo's test suite
   (`supabase-js` needs a global WebSocket).
2. **Claude Code**, signed in.
3. `gh auth login` — browser flow, HTTPS.
4. `gh repo clone phuriphatma/samomdkkuweb && cd samomdkkuweb && npm ci`
5. `npm run dev` → open `localhost:5174`. **They must see the real site running
   on their own machine.** This is the moment the whole thing becomes real to
   them; do not skip it to save five minutes.
6. **The practice pull request.** Have them ask Claude, in their own words, to
   change one visible word somewhere harmless, then:
   `git checkout -b tool/practice-<their-name>` → commit → `gh pr create`.
7. CI runs. **Show them the red/green.** Show them that red means it cannot be
   merged — this is what `required_status_checks` buys, enabled 2026-08-27.
8. You approve, they press merge. **They merge it, not you.**
9. Show them that the site has NOT changed. Merging is not publishing; the
   owner deploys, in batches (`skills/deploy-vm.md`). Say the words *"ขึ้นเว็บ
   จริงในรอบ deploy ถัดไป"* out loud, once, here — or it will be asked every
   time forever.

## The five sentences they leave with (5 min)

Say these; do not email them.

1. **"แก้ได้เฉพาะในโฟลเดอร์ของเครื่องมือตัวเอง"** — a pull request that touches
   anything else will be stopped, and that is a feature. `CODEOWNERS` names the
   protected paths.
2. **"อยากได้เครื่องมือใหม่ เปิด issue ก่อน"** — the tool-request template. The
   issue is the agreement; the review compares the work to it.
3. **"อยากเพิ่มทีหลัง เปิด issue ใหม่ ไม่ต่อในอันเดิม"**.
4. **"ห้ามใส่ชื่อจริง รหัสนักศึกษา หรือรูปคนจริงลงใน commit หรือใน screenshot"**
   — the repository is PUBLIC and git history is permanent. GitHub's scanner
   catches API keys; **it does not catch a person's name.**
5. **"ข้างในกล่องเป็นของฝ่าย"** — layout, colour, wording. IT reviews and
   publishes; IT does not redesign.

---

## The owner's habit, and it is the one that decides whether this works

**Send it back; do not fix it yourself.**

A contributed page will look slightly foreign — spacing a little off, a green
that is nearly the brand green. Asking for a change in a review comment costs a
sentence and keeps the work theirs. Opening the file and fixing it yourself
costs a session and takes the pen back permanently — which is the bottleneck
this whole workflow was built to remove, rebuilt by hand.

*(This started life as a question — "can you live with a page you did not
design?" — and it was the wrong shape. Nothing ships without the owner's
approval and the owner's deploy, so control was never at stake. It is a habit,
not a decision.)*

## Reviewing their pull request

The owner does not have to read it. In a **fresh** Claude session:

```
/code-review <PR#>
```

- **Fresh matters.** A session that helped write the change reviews its own
  assumptions. Start a new one.
- **Give it the spec**: paste the tool-request issue, and ask it to compare the
  diff *to the issue*, not just to itself. Claude reads the diff; only the issue
  says what was supposed to be built.
- **What this covers safely**: anything under `public/embed/**`. Worst case is
  one broken page inside a frame that reaches nothing.
- **What it does NOT cover**: the data doors in `src/js/data/`, and anything in
  the `CODEOWNERS` list. Those decide who may see what, that rule lives in the
  database rather than in the diff, and the owner reads those personally.

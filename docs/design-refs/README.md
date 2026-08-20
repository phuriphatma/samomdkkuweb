# Design references

Screenshots the owner sent to describe a design, kept on disk so a later
session can actually LOOK at them instead of reconstructing from prose.

**The images are gitignored, and that is deliberate: both repos are PUBLIC.**
Every one of these is a screenshot of the live org chart, so it carries student
portraits and full names. Those are already published by
`get_public_team_chart()` on the site itself — but committing them here would
put the same faces into a second, permanent, mirrorable channel that nobody
consented to. The `.gitignore` in this folder is the mechanism; this paragraph
is why, so nobody "fixes" it.

So: **the files are local-only and will not survive a fresh clone.** Anything a
future session must know has to also be written down in prose, in `STATE.md`.
This file is the index that says what each one shows.

## `2026-08-20-old-connector-chart.png`

iPad Safari, `samo.md.kku.ac.th`, taken 2026-08-13. **This is the แผนผัง the
owner wants RESTORED** (see the ⛳ OWED section at the top of STATE.md's
NEXT-SESSION PROMPT). Deleted in `1f966f3`; last good copy of the code is its
parent, `befd30e`.

What it shows, in case the file is gone:

- ONE root ฝ่าย per section — here ฝ่ายดิจิทัลและสื่อสารองค์กร — as a **white
  rounded box with a coloured top border** (yellow, the ฝ่าย's `--dept-*` tint),
  a coloured dot, the ฝ่าย name, and a **count pill** "17 ตำแหน่ง · 43 คน" plus
  a chevron.
- Directly under it, **centred**, the อุปนายก's portrait card: a ~90px 3:4
  photo with the name and ชื่อเล่น stacked BELOW it, centre-aligned.
- Below that a **horizontal elbow connector** — a vertical drop, a horizontal
  bar, and a tick down into each child — fanning out to a ROW of three sibling
  boxes (ฝ่าย PR / ฝ่าย ComArt / ฝ่าย IT), each styled like the root box.
- Each of those repeats the pattern one level down (หัวหน้าฝ่าย PR → its
  portrait → ฝ่าย Media management …), and **below depth 1 the chart switches to
  a vertical spine** rather than fanning out again.
- Reading order is top-to-bottom, and the whole section scrolls horizontally
  inside its own scroller rather than growing the page.

The three constraints that make it fit 400 people are written at the top of the
CSS block it came from — `git show befd30e:src/css/org-chart.css | sed -n
'665,905p'`. Read those before changing any of them.

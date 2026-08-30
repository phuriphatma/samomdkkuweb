# Who else can recover this, if one person disappears

**Run `npm run succession:audit` before reading further.** It prints the live
answer for the systems an API can be asked; the numbers below are from
2026-08-30 and will rot. This page is the map and the plan.

## The thing that was being got wrong

The continuity of this project was being discussed as a **GitHub question** —
should the repository move off a personal account. That is a real question
(`skills/move-the-repo-to-an-organisation.md`), and it is the **smallest** part.

GitHub holds the source code. The source code is the one thing here that is
already backed up on every contributor's laptop. What is *not* replaceable:

- the **database**, with every student's passport, every ticket, every account
- the **Google sign-in** every student uses
- the **VM** that serves `samo.md.kku.ac.th`
- the **Drive** the หนังสือโครงการ files live in
- `.env.local`, the one file every credential is in

None of those are on GitHub, and losing any of them is worse than losing the
repository.

## What is actually held by whom

| System | If it is lost | Checked how |
|---|---|---|
| **Supabase org `mdstuddatabeta`** — the production database | Everything. There is no other copy of student data. | `npm run succession:audit` |
| **The KKU VM** | `samo.md.kku.ac.th` keeps serving whatever is on disk, but **nobody can ever deploy again** | ssh config, by hand |
| **Google Cloud project `593995881808`** — the OAuth client | Every student's Google sign-in stops. Username/password still works. | Google console, by hand |
| **The Drive + Apps Script account** | Uploaded PR files and the หนังสือโครงการ mail | Google console, by hand |
| **`.env.local`** | Database admin, VM sudo, Discord, KKU SSO — all of it at once | it is on one Mac |
| **Cloudflare account** | Per-PR previews only. Production is unaffected. | `npm run succession:audit` |
| **GitHub repo** | Least bad: every clone is a copy. Issues and history would hurt. | `npm run succession:audit` |

⚠️ **Four different identities own parts of production** — a personal GitHub
account, one gmail (Supabase + Cloudflare), a SAMO gmail (dev + Apps Script),
and KKU (VM, DNS, SSO). Nobody holds all four, and no single document listed
them until this one.

## What was found on 2026-08-30

- **Cloudflare: one member.** One gmail, no second person.
- **Supabase: one Owner** (a gmail) plus one Administrator on a **kkumail**
  address — which expires when that student graduates.
- **GitHub: one admin.**
- **The VM key is on one Mac**, `IdentitiesOnly yes`, and nothing here can tell
  whether a second public key is in the VM's `authorized_keys`.

None of this is an emergency today. All of it becomes one on a predictable date.

## The rule to design for

**A student organisation loses its people on a schedule.** Every year, someone
graduates. So the question is never "do we trust this person" — it is
**"what happens on the day their account stops existing?"**

For each system: **at least two people, and at least one of them on an identity
that does not graduate.** A kkumail address is not that. Neither is a personal
gmail nobody else can get into.

## The plan, in order of what it costs if skipped

1. **Put a second ssh key on the VM.** Highest damage, smallest effort. If the
   one Mac holding `~/.ssh/id_samo_vm` is lost, deployment ends permanently —
   the site keeps serving, so nobody notices until the next change is needed.
2. **Get `.env.local` off one machine.** Not into git — into something the SAMO
   account owns (a password manager entry, or a document only officers can
   open). Everything else on this list is recoverable *if* this file survives.
3. **Add a second Owner to the Supabase organisation**, on an identity that
   does not graduate. Today's second member is a kkumail address.
4. **Check the Google Cloud project's Owners** (`593995881808`). If the only
   Owner is a graduating account, student Google sign-in has an expiry date
   nobody has written down. Add the SAMO account as an Owner.
5. **Confirm the Apps Script + Drive account**, and give a second person access.
   `.claude/rules/security.md` says "the SAMO account"; confirm which, in
   writing.
6. **Add a second Cloudflare member.**
7. **Move the repo to a GitHub organisation** —
   `skills/move-the-repo-to-an-organisation.md`. Last on this list on purpose:
   it is the most discussed and the least dangerous.
8. **Name the KKU contact** for the SSO registration and the DNS record, so the
   next person knows who to email.

## Then make it a guard

`tools/succession-audit.mjs` is a REPORT, not a proof, because a proof that is
red for something nobody is fixing today teaches people to ignore proofs
(`tools/run-proofs.mjs` says why). **Once steps 1–6 are done, register it in
`run-proofs.mjs`** — from then on it guards a good state instead of announcing a
bad one, and it goes red the day somebody is removed.

# Succession

> If one person disappears, who can recover which system

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

## The account model — DECIDED, do not re-litigate

Two Google accounts are **role accounts, handed to each year's student**:

| Account | Holds |
|---|---|
| `mdstuddata.beta@gmail.com` ("studbeta") | **production Supabase** · **Google Cloud project `593995881808`** (the OAuth client behind student Google sign-in) · **Cloudflare** |
| `samomdkku.ai@gmail.com` | **dev Supabase** (`samomdkkuaiorg`) · Apps Script + Drive |

**This is the right shape and it should be kept.** Neither is a kkumail, so
neither is deleted at graduation, and the project's identity does not live in a
person's own account. It is also a genuinely different thing from the 17 shared
password accounts deleted on 2026-08-17/18 (`.claude/rules/security.md`): those
were *application* logins used simultaneously by many people, which destroyed
"who did this". These are *infrastructure owner* accounts, held by one person at
a time, which is a normal and defensible pattern.

⚠️ **But "it does not graduate" is a property of the RECOVERY SETTINGS, not of
the address.** A gmail whose recovery email is a kkumail, or whose 2FA lives
only on a graduating student's phone, expires exactly like a kkumail — just
silently, and with no support line to call, because free Google accounts have
none. **This is the first thing to check, and nothing else on this page matters
until it is true.**

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

## What was found on 2026-08-30

- **studbeta alone holds three of the four systems that matter** — the
  production database, student Google sign-in, and Cloudflare. One Google
  account recovery away from losing all three at once.
- **Cloudflare: one member, Super Administrator, 2FA OFF**, and account-level
  2FA enforcement off. One gmail password is full control.
- **Supabase: one Owner** (studbeta) plus one Administrator on a **kkumail**
  address, which expires when that student graduates — after which it is back
  to one holder.
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

## The plan

**Nothing has to move.** Every system below supports *adding a second holder*;
none of it needs a migration. The whole plan is invitations and settings.

### Step 0 — the one that makes the rest true

**On BOTH role gmails**, in the Google account settings:

1. Recovery email must **not** be a kkumail, and must not be the same address on
   both. Point each at the *other* role account — mutual, free, and neither one
   graduates.
2. Turn 2FA **on**, and put the **backup codes** in the handover store (step 2
   below) — not only on a phone that graduates.
3. Recovery phone: if it is a student's personal number, it is a graduation
   date. Remove it or replace it.

Until this is done, every other step below is protecting an account that can
still evaporate.

### Step 1 — make the two role accounts mutually redundant

Add the *other* role account as a full holder of each system. Three invitations,
about ten minutes:

| System | Do this |
|---|---|
| Supabase org `mdstuddatabeta` | Invite `samomdkku.ai@gmail.com` as **Owner** |
| Cloudflare | Add `samomdkku.ai@gmail.com` as a member with **Super Administrator**, and turn **on** account 2FA enforcement |
| Google Cloud `593995881808` | IAM → add `samomdkku.ai@gmail.com` as **Owner** |

⚠️ **This is only real if a different HUMAN can get into the second account.**
If both gmails sit on the same phone with the same recovery number, the second
owner is decorative — the same shape as a permission check added beside one that
already allows everything. Two accounts is the mechanism; **two people** is the
property.

### Step 2 — the things no account can hold

4. **Put a second ssh key on the VM.** Highest damage, smallest effort. If the
   one Mac holding `~/.ssh/id_samo_vm` is lost, deployment ends permanently —
   and the site keeps serving, so nobody notices until the next change is needed.
5. **Get `.env.local` off one machine.** Not into git — into something a role
   account owns (a password manager entry, or a document only officers can
   open). It is the single richest point of failure here, and it is also where
   the 2FA backup codes from step 0 belong.

### Step 3 — the rest, in cost order

6. Confirm the **Apps Script + Drive** account is `samomdkku.ai@gmail.com` in
   writing, and that studbeta can reach it too.
7. **Move the repo to a GitHub organisation.** This is the one that stops the
   owner having to add every contributor by hand. **The complete runbook is
   `skills/move-the-repo-to-an-organisation.md`** — phases, commands,
   verification and rollback; do not plan it from this page. Deliberately near
   the end of this list: the most discussed, the least dangerous. Nothing in
   the running application routes through GitHub, so no student or ฝ่าย member
   sees any difference (that runbook §8 has the checked table).
8. **Name the KKU contact** for the SSO registration and the DNS record.

### Every year, at the handover

Do it **before** the outgoing student leaves, never after:

- Change the password on both role accounts, and re-enrol 2FA on the incoming
  person's device.
- Re-point the recovery phone.
- Remove the outgoing student's **kkumail** from the Supabase org and from
  GitHub — a role account handover does not revoke their personal access.
- Have the incoming person **actually sign in to all four consoles** while the
  outgoing one is still reachable. A handover is not done when the password is
  written down; it is done when someone else has used it.

## Then make it a guard

`tools/succession-audit.mjs` is a REPORT, not a proof, because a proof that is
red for something nobody is fixing today teaches people to ignore proofs
(`tools/run-proofs.mjs` says why). **Once steps 1–6 are done, register it in
`run-proofs.mjs`** — from then on it guards a good state instead of announcing a
bad one, and it goes red the day somebody is removed.

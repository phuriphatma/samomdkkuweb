# Email — what sends it, what the ceilings are, and what the VM can do

**Status: assessment, 2026-08-28. Nothing here is built beyond the three
`samo-dev` settings noted in §6.** Written after the owner asked whether to
migrate email off Apps Script onto a self-hosted server, and how to raise the
limits without getting flagged.

**The short answer, in one line each:**

- **The VM CAN send mail** — through an authenticated relay on 587/465, proven
  with a real SMTP session, needing nothing from anyone. §3.
- **The VM cannot BE a mail server** — port 25 outbound is blocked and the
  domain publishes `DMARC p=reject`. That is the part that would get us flagged.
- **The VM cannot RECEIVE mail** — no inbound port but 443. This is what kills
  the Mailpit trap (§7), and it is a separate fact from the two above.
- **The cheapest large win needs no infrastructure at all** — KKU runs Google
  Workspace and we are not using it. §4.
- **The prize is bigger than a quota**: there is no password reset in this app,
  and mail is why. §2.

---

## 1. What sends email today

Two senders, and only one of them is admitted by `CLAUDE.md`.

| # | Sender | What it sends | Ceiling |
|---|---|---|---|
| 1 | **Apps Script `MailApp.sendEmail`** — `notifyProjectEmail` in `appscript/prform.gs` | the หนังสือโครงการ notification, to the curated address in `project_settings.uni_staff_email` (an `@kku.ac.th` today) | **100 recipients/day** on a consumer account, **1,500/day** on Google Workspace |
| 2 | **Supabase Auth** (built-in service) | nothing, in production, on purpose | 2 messages/hour, **and it refuses to deliver to anyone who is not a project team member** |

Sender 1 is domain-allow-listed (`EMAIL_DOMAIN_ALLOWLIST`), which matters
because the `/exec` URL is public and unauthenticated — without that check the
handler is an open relay under the display name "MDKKU SAMO".

Sender 2 is the interesting one. Production sets `mailer_autoconfirm = true`
and configures no SMTP, so `updateUser({email})` changes the address
immediately and sends nothing — `src/js/auth.js` says so in a comment, and it is
deliberate. **The app has been designed around the built-in service rather than
using it.**

## 2. The consequence nobody wrote down

**There is no password reset.** `resetPasswordForEmail` appears nowhere in
`src/js`. That is not a product decision — it is what falls out of a mail
service that will not deliver to a student address. Anyone who forgets their
password needs a human.

**That is the strongest argument for doing this work**, and it is a bigger prize
than raising the Apps Script quota.

## 3. What the VM can and cannot do

⚠️ **An earlier version of this section said "do not self-host" without
separating three different things, and that was too broad. The owner pushed
back — "isn't there a way to send email from the VM?" — and they were right.**
The VM is a perfectly good mail *client*. It just cannot be a mail *server*.

Three directions, each probed on the box itself on 2026-08-28:

| Direction | Verdict | Evidence |
|---|---|---|
| **Receive SMTP** (something outside connects in) | ❌ impossible | VM holds only `10.101.111.181`; public `202.28.95.46` has 25/587/465/1025 filtered, **443 open as the control** |
| **Send direct to recipients' MX** (port 25 out) | ❌ blocked | `aspmx.l.google.com:25` refused from the VM — the standard anti-spam egress rule |
| **Send through an authenticated relay** (587/465 out) | ✅ **works** | see below |

**Every relay worth using is reachable from the VM**, verified by TCP connect,
with `github.com:443` as the control:

```
smtp.gmail.com:587              OPEN      smtp-relay.brevo.com:587    OPEN
smtp.gmail.com:465              OPEN      smtp.sendgrid.net:587       OPEN
smtp-relay.gmail.com:587        OPEN      smtp.resend.com:587         OPEN
email-smtp.us-east-1…:587       OPEN      smtp.postmarkapp.com:587    OPEN
api.resend.com:443              OPEN      aspmx.l.google.com:25       blocked
```

⚠️ **A TCP handshake is not an SMTP session** — a captive proxy answers one and
not the other. So the session was actually opened, and Gmail really talks:

```
$ openssl s_client -starttls smtp -connect smtp.gmail.com:587
250-smtp.gmail.com at your service, [202.28.118.103]
250-AUTH LOGIN PLAIN XOAUTH2 PLAIN-CLIENTTOKEN OAUTHBEARER XOAUTH
250 SMTPUTF8
```

STARTTLS completes and `AUTH` is offered. **The VM can authenticate and send
today**, with no request to anyone.

📌 The VM's outbound NAT address is **`202.28.118.103`** — a *different* address
from the `202.28.95.46` that serves the website.

### So what is actually ruled out

Only the *independent mail server*, and for two reasons that both still hold:

- **Port 25 outbound is blocked**, so it could not deliver to recipients anyway.
- **`kku.ac.th` publishes `DMARC p=reject`** (`v=DMARC1; p=reject;
  rua=mailto:mail-report@kku.ac.th`) with no `sp=`, so `md.kku.ac.th` inherits
  *reject* and publishes no SPF or MX of its own. Mail claiming either domain
  from an unblessed source is discarded, not spam-foldered. **DNS is
  `ns0`–`ns4.kku.ac.th` (SOA contact `noc.kku.ac.th`)**, so the records that
  would fix that are a request to KKU NOC.

DMARC constrains **which address you send AS**, not which machine sends. Relay
through Google as the SAMO Gmail address and it is aligned today; send as
`@md.kku.ac.th` and you need DKIM records from NOC, whatever host you use.

📌 **Cloudflare is not in the mail path at all** — Pages is retired, Cloudflare
does not send email, and nothing there is limiting or flagging anything.

📌 Postfix runs on the VM already (`inet_interfaces = loopback-only`,
`relayhost` empty) for local delivery only. **The queue is empty and nothing is
deferred**, so it is unused rather than broken — but with port 25 blocked and no
relayhost, any system mail to an outside address today would go nowhere. Setting
`relayhost` gives cron and certbot somewhere to send, and gives the app queuing
and retry for free.

## 4. What KKU already has, and why it is the cheap win

`MX` for both `kku.ac.th` and `kkumail.com` points at `ASPMX.L.GOOGLE.COM`:
**KKU runs Google Workspace**, and `include:_spf.google.com` is already in the
`kku.ac.th` SPF record.

So mail sent *through Google, from a KKU account* is aligned, DKIM-signed and
trusted **today, with no DNS request and no new service**. The ceilings:

| Path | Recipients/day | Needs |
|---|---|---|
| Apps Script `MailApp`, consumer account | 100 | (what we have now, if the account is consumer) |
| Apps Script `MailApp`, Workspace account | **1,500** | move the script's owner account |
| `smtp.gmail.com` + app password, consumer | 500 | an app password |
| `smtp.gmail.com` + app password, Workspace | 2,000 | an app password |
| `smtp-relay.gmail.com` (Workspace) | 10,000 | a Workspace admin to enable the relay |

**First thing to check, one line, no deploy needed once you can run the script:**

```js
Logger.log(MailApp.getRemainingDailyQuota());   // 100 → consumer · 1500 → Workspace
```

If it prints ~100, moving the Apps Script project to a `@kku.ac.th` Workspace
account is a **15× quota increase for zero cost and zero new infrastructure.**

⚠️ Moving the script account is not free of consequences: `prform.gs` uses
`DriveApp`, and the whole Drive tree (`My Drive/IT Database`) lives in the
current account. Moving the *script* means either moving that tree or putting it
on a Shared Drive first — which `.claude/rules/security.md` already recommends
for a different reason (the OAuth grant reaches the entire Drive).

## 5. If you want password reset — the one thing that needs an outside service

Supabase needs SMTP credentials of its own; `MailApp` cannot serve it. With
custom SMTP configured the auth rate limit goes from 2/hour to 30/hour, tunable.

| Option | Free tier | Honest catch |
|---|---|---|
| **Brevo** | 300/day (~9,000/mo) | best free tier; needs DKIM/SPF records |
| **Resend** | 3,000/mo, 100/day | nicest API; needs DKIM/SPF records |
| **Amazon SES** | ~$0.10 per 1,000 | cheapest at scale, most setup, sandbox to escape |
| **SendGrid** | none — free plan discontinued | 60-day trial, then $19.95/mo |
| **Gmail SMTP app password** | 500/day (consumer) | **no DNS request at all**; sends as the gmail address, not as SAMO's domain |

**Recommended order:**

1. **Gmail SMTP app password as the pilot** — it is the only option that needs
   nothing from KKU NOC, so it proves the reset flow end to end this week. Mail
   arrives from the SAMO Gmail address; deliverability is Google's.
2. **Then one request to KKU NOC** for a dedicated sending subdomain (e.g.
   `mail.samo.md.kku.ac.th`) with the SPF/DKIM records Brevo or Resend generates.
   That is what buys mail that says SAMO and passes `p=reject`. Ask for the
   subdomain rather than records on `md.kku.ac.th` — it is a smaller ask and it
   keeps our sending reputation off the faculty domain.

## 5a. The option §3 opens up — let the VM send the notification itself

Because the VM can reach every relay on 587, **`notifyProjectEmail` does not have
to live in Apps Script at all.** `samo-notify.service` is already a Node service
on `:8787` behind nginx, already the place Discord notifications go. Adding mail
to it means:

- **the Apps Script mail quota stops mattering** — the ceiling becomes the
  relay's (Gmail 500/day, Workspace relay 10,000/day, Brevo 300/day free);
- **one notification path instead of two.** Today a หนังสือโครงการ notification
  fans out to Discord through the VM and to email through Apps Script — two
  services, two failure modes, two places to look;
- **the recipient allow-list moves off a public unauthenticated endpoint.** The
  GAS `/exec` URL ships in the browser bundle, which is why `sendProjectEmail`
  needs `EMAIL_DOMAIN_ALLOWLIST` at all — it is guarding an open relay. The
  notify service is not public in the same way.

**This competes with "move the Apps Script to a Workspace account", it does not
follow it.** Moving the script is smaller (an account change, no code) and keeps
Drive and mail together; moving the mail to the VM is more work but retires the
GAS mail path and its quota permanently. Both are defensible — **the Workspace
move is the right first step**, because it is reversible, needs no code review,
and buys 15× immediately.

⚠️ Whichever wins, `MailApp` stays for nothing else — Apps Script keeps the Drive
uploads regardless.

## 6. What was actually changed on 2026-08-28

`samo-dev` only — production untouched. Three keys, verified by diffing the full
242-key auth config before and after:

| key | was | now | why |
|---|---|---|---|
| `mailer_autoconfirm` | `false` | `true` | production has had it `true` all along, and `src/js/auth.js` **depends** on it: with it `false`, `updateEmail()` on a preview leaves the change pending instead of applying it. Dev was diverging from prod on a flow previews exist to test. |
| `site_url` | `http://localhost:3000` | `http://localhost:5174` | port 3000 is not one this repo has ever used |
| `uri_allow_list` | *(empty)* | localhost 5174/4173 + `*.samomdkkuweb.pages.dev` | empty meant every redirect fell back to `site_url` — so no preview could complete a redirect flow |

**Still true of `samo-dev`, and needing the owner:** `external_google_enabled`
is `false`, so **Google sign-in does not work on dev at all**. Previews can only
exercise username/password. Fixing it needs a Google OAuth client for the dev
project.

## 7. The abandoned idea, recorded so it is not re-proposed

`docs/state/phuriphatma.md` recorded "run **Mailpit** on the VM, point
`samo-dev`'s SMTP at it". Mailpit is a good tool and the reasoning was sound —
it just cannot work here, for blocker 1 in §3: Supabase Cloud cannot open a TCP
connection to a box with no public inbound port but 443.

**If a browsable trap is still wanted, the transport is HTTPS, not SMTP.**
Supabase's *Send Email Hook* (`hook_send_email_uri`) POSTs every auth email to
an endpoint instead of sending it, and 443 is the one port that reaches the VM.
It would follow the pattern already on the box — nginx `location = /notify` →
Node on `:8787` → a systemd unit. Not built; it is a new public endpoint on the
production VM and wants an explicit decision first.

# Vaultwarden — SAMO's password vault

`https://samo.md.kku.ac.th/vault/` · files in `server/vaultwarden/`

Self-hosted Bitwarden-compatible server. Everyone uses the **normal Bitwarden
apps** (extension, phone, desktop) pointed at our server — there is no
"Vaultwarden app" to install.

## Why it is at a PATH and not a subdomain

KKU issues no subdomain (the same wall that put the docs at `/docs`), and the
VM cannot obtain its own public cert — KKU's reverse proxy terminates
`*.md.kku.ac.th` and forwards to `https://10.101.111.181`, where nginx answers
with a self-signed cert under `server_name _`. A path on the main host is the
only address available.

The widely-cited *"the Android app fails on a subpath"* report
([vaultwarden#3096](https://github.com/dani-garcia/vaultwarden/discussions/3096))
turned out to be an **incomplete TLS chain**, not the subpath. KKU's edge serves
a complete DigiCert chain — verify any time with:

```bash
echo | openssl s_client -connect samo.md.kku.ac.th:443 \
  -servername samo.md.kku.ac.th 2>&1 | grep "Verify return code"
# want: Verify return code: 0 (ok)
```

If that ever stops saying 0, **mobile clients break first and browsers keep
working** — which looks like "Vaultwarden is broken on phones". Check this
before believing that.

## ⛔ The nginx config has TWO homes

`server/nginx-samo.conf` (repo) and `/etc/nginx/sites-available/default` (live).
**`deploy.sh` does NOT copy it** — it only runs `nginx -t && systemctl reload`.
Installation is a manual `cp`, documented in that file's own header.

So: **edit the repo file, then copy it up. Never edit the live file only.**
Anyone following the header comment later would otherwise silently delete the
`/vault/` block, `/vault/` would fall through to the SPA catch-all, and every
client would receive `index.html` — which reads as "Vaultwarden is down", not
"nginx was overwritten".

`server/vaultwarden/vault-config.test.js` guards the config's internal
consistency (subpath agreement, `proxy_pass` with no URI part, the `map` at
http level). It cannot see the live file — that part is on you.

## Install (once)

```bash
ssh samo-vm                       # VPN required

# 1. Security updates FIRST. This box did not auto-patch before; a credential
#    vault on an unpatched box is the biggest risk in this whole design.
sudo apt-get update
sudo apt-get install -y unattended-upgrades sqlite3
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes
systemctl status unattended-upgrades --no-pager

# 2. Docker
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker

# 3. Lay the files down
sudo mkdir -p /opt/vaultwarden/data
sudo chmod 700 /opt/vaultwarden
```

From your laptop:

```bash
scp server/vaultwarden/docker-compose.yml samo-vm:/tmp/
scp server/vaultwarden/backup.sh          samo-vm:/tmp/
scp server/vaultwarden/vaultwarden.env.example samo-vm:/tmp/
scp server/vaultwarden/vaultwarden-backup.{service,timer} samo-vm:/tmp/
scp server/nginx-samo.conf                samo-vm:/tmp/
```

Back on the VM:

```bash
sudo mv /tmp/docker-compose.yml /opt/vaultwarden/
sudo mv /tmp/backup.sh /opt/vaultwarden/ && sudo chmod 700 /opt/vaultwarden/backup.sh
sudo mv /tmp/vaultwarden.env.example /opt/vaultwarden/vaultwarden.env
sudo chmod 600 /opt/vaultwarden/vaultwarden.env

# Admin token — paste the FULL $argon2id$... string into ADMIN_TOKEN=
sudo docker run --rm -it vaultwarden/server:1.37.2-alpine /vaultwarden hash
sudo nano /opt/vaultwarden/vaultwarden.env      # ADMIN_TOKEN + SMTP_*

sudo docker compose -f /opt/vaultwarden/docker-compose.yml up -d
curl -sf http://127.0.0.1:8788/alive && echo "  <- container alive"

# nginx — repo file, copied up (see the TWO HOMES warning above)
sudo cp /tmp/nginx-samo.conf /etc/nginx/sites-available/default
sudo nginx -t && sudo systemctl reload nginx

# backups
sudo mv /tmp/vaultwarden-backup.service /tmp/vaultwarden-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vaultwarden-backup.timer
```

**Verify the timer is actually SCHEDULED, not merely enabled** — a timer with
only monotonic triggers reports `enabled`/`active` while never firing
(`.claude/rules/mistakes.md` class 7). Ours uses `OnCalendar`, so:

```bash
systemctl list-timers vaultwarden-backup --no-pager
# NEXT must show a real date. "infinity" or a blank NEXT means it is NOT scheduled.
sudo systemctl start vaultwarden-backup.service   # run one now
sudo ls -la /var/backups/vaultwarden/             # an archive must exist
```

## First account

`SIGNUPS_ALLOWED=false`, so the first account is made by opening signups for
exactly as long as it takes:

1. `SIGNUPS_ALLOWED=true` → `docker compose up -d` → register your kkumail
2. `SIGNUPS_ALLOWED=false` → `docker compose up -d` again. **Confirm it took**:
   an incognito window at `/vault/#/register` must refuse.
3. `/vault/admin` → Organizations → create **SAMO MDKKU**
4. Collections `IT-Core`, `Comms`, `Handover`; invite people by kkumail; assign

## Test the websocket (UNVERIFIED until you do)

Whether KKU's edge forwards `Upgrade` is unknown — my pre-deploy probe against
`/notify` proved nothing, because that backend does not speak WebSocket and a
200 is the right answer either way.

```bash
curl -s -i -o - -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://samo.md.kku.ac.th/vault/notifications/hub | head -1
# 101 Switching Protocols = live sync works
# 200 / 400 / 426 = the edge strips Upgrade -> clients POLL instead.
```

**Polling is not a failure.** The vault works either way; you lose instant
cross-device sync and "log in with device". Do not spend a day on this.

## Restore

```bash
sudo systemctl stop vaultwarden-backup.timer
sudo docker compose -f /opt/vaultwarden/docker-compose.yml down
sudo tar -xzf /var/backups/vaultwarden/vaultwarden-<STAMP>.tar.gz -C /opt/vaultwarden/data
# ⚠️ A stale WAL beside a restored db CORRUPTS it as sqlite tries to replay.
sudo rm -f /opt/vaultwarden/data/db.sqlite3-wal /opt/vaultwarden/data/db.sqlite3-shm
sudo docker compose -f /opt/vaultwarden/docker-compose.yml up -d
```

The archive carries `db.sqlite3`, `config.json`, `rsa_key*`, `attachments/` and
`sends/`. **A database-only restore loses every attachment and invalidates
every session** — that is why the script collects all of it.

## Offboarding someone

1. `/vault/admin` → Organizations → SAMO MDKKU → Members → **Remove**
2. Rotate what they could read while a member — not everything SAMO owns, just
   their collections. This short list is the entire reason for per-person
   accounts.

## Break-glass — NOT optional

The VM's sudo password and SSH keys live in a vault **hosted on that VM**. If
the box is down, the credentials to fix it are inside the thing that is down.

Print the SAMO Gmail password + its 2FA backup codes + one working SSH key,
seal it, give it to the อาจารย์ที่ปรึกษา. Re-do it whenever the Gmail password
changes.

## Routine care

```bash
# monthly: update the image (the tag is pinned on purpose — updates are deliberate)
sudo docker compose -f /opt/vaultwarden/docker-compose.yml pull
sudo docker compose -f /opt/vaultwarden/docker-compose.yml up -d

# from your laptop, regularly: get a copy OFF the VM
./server/vaultwarden/pull-backup.sh ~/samo-vault-backups
```

A backup that only exists on the VM is not a backup — the VM dying is the case
you are insuring against.

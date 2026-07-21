# Self-hosting on the KKU VM (moving off Cloudflare Pages)

The app moved from Cloudflare Pages to a KKU virtual machine (Ubuntu, behind
the university reverse proxy at `samo.md.kku.ac.th` → `https://10.101.111.181`).
**Supabase stays on Supabase Cloud** — only the frontend hosting and the
Discord notify function move onto the VM.

The single non-obvious thing about this move: **Cloudflare Pages did three
jobs that a plain Nginx static host does not.** They must be replicated or
they fail silently:

| Cloudflare mechanism | What it did | Replacement on the VM |
|---|---|---|
| `functions/notify.js` (Pages Function) | served `POST /notify` for all Discord notifications | `server/notify-server.mjs` (Node) behind Nginx |
| `public/_headers` | cache policy (HTML no-cache, assets immutable, build.json no-store) | `add_header` blocks in `server/nginx-samo.conf` |
| `public/_redirects` | SPA fallback for `/*` and `/admin/*` | `try_files` blocks in `server/nginx-samo.conf` |

Miss `/notify` and every PR / Vital Sound / หนังสือโครงการ Discord ping
silently no-ops. Miss the headers and iPad Safari pins users on a stale
bundle. Miss the `/admin/*` fallback and an admin refresh serves the wrong app.

---

## Layout on the VM

```
/home/ubuntu/samo-projects/samomdkkuweb        # this repo (has .env.local)
/home/ubuntu/samo-projects/samomdkkupassport   # passport repo, base '/passport/'
/var/www/samo-web                              # Nginx root for the public+admin app
/var/www/passport                              # Nginx root for passport
/etc/samo-notify.env                           # notify secrets (chmod 600, root)
/etc/systemd/system/samo-notify.service        # notify service
/etc/nginx/sites-available/default             # from server/nginx-samo.conf
```

## One-time setup

1. **Node 22 + repos** (already done): clone both repos into `~/samo-projects`,
   `npm install`, add each app's `.env.local` (only the public
   `VITE_SUPABASE_ANON_KEY` + URL — never a service_role key).

2. **Passport base path** — commit `base: '/passport/'` to the passport repo's
   `vite.config.js` so a future `git pull` doesn't clobber it.

3. **Notify service**:
   ```bash
   sudo cp server/samo-notify.env.example /etc/samo-notify.env
   sudo chown root:root /etc/samo-notify.env && sudo chmod 600 /etc/samo-notify.env
   sudo nano /etc/samo-notify.env      # paste the DISCORD_* values from the
                                       # old Cloudflare Pages env vars
   sudo cp server/samo-notify.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now samo-notify
   journalctl -u samo-notify -f        # confirm "listening on ... /notify"
   ```

4. **Nginx**:
   ```bash
   sudo cp server/nginx-samo.conf /etc/nginx/sites-available/default
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. **Supabase + Google OAuth allow-list** (easy to forget — breaks sign-in):
   add `https://samo.md.kku.ac.th` to
   - Supabase → Authentication → URL Configuration (Site URL + Redirect URLs)
   - Google Cloud Console → OAuth client → Authorized JavaScript origins + redirect URIs

6. **Security**: change the VM password (`passwd`), switch SSH to key-only
   (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then
   `sudo systemctl restart ssh`). The IT-issued password was weak and
   should be considered burned.

## Every deploy after that

```bash
cd ~/samo-projects/samomdkkuweb
./server/deploy.sh      # pull + build both apps + publish + restart notify + reload nginx
```

## Smoke tests

```bash
curl -sk https://127.0.0.1/build.json                 # {"buildId":"..."} , header Cache-Control: no-store
curl -sk https://127.0.0.1/notify                     # {"ok":true,"service":"samo-notify"}
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1/admin/   # 200 (admin index)
```

Then from a browser (off-VPN, to confirm public reach): submit a test PR and
verify the Discord message lands. If `notify_log` is enabled (migration 0055 +
`SUPABASE_*` in the env file), `select * from notify_log order by at desc limit 5;`
shows the outcome.

## Notes

- The notify Node server reuses `functions/notify.js` **unchanged** — the same
  code the vitest suite covers. `functions/package.json` (`"type":"module"`)
  is what lets `node` import it; the repo root stays CommonJS for Vite.
- Discord webhook egress is now the **KKU VM IP**, not GAS's shared IP — the
  Cloudflare-1015 per-IP block that plagued the GAS era does not apply here.
- If the VM is only reachable on-campus/VPN, external students lose access —
  verify public reachability before decommissioning Cloudflare.

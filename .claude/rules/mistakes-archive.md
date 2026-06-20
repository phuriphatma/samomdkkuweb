# Mistakes log — archive

Entries moved out of `.claude/rules/mistakes.md` to keep that file under the
agent context-budget limit. These are still real, still apply — they're just
stable / niche enough that they don't need to sit in the always-read hot path.
If a symptom isn't in `mistakes.md`, check here.

Each entry: **Symptom → Cause → Fix → Where it lives now**.

---

## Hardcoded reserved-username lists rot when new staff accounts are added

**Symptom**: Registration form lets a public visitor try
`samomdkkuradiology` (or any of the 9 VP usernames added in 0010/0011).
Backend uniqueness on `public.users.username` returns
"Username นี้มีผู้ใช้งานแล้ว" — but only IF the VP auth user has already
been seeded. If not, the visitor squats the name and the admin can't
seed the legitimate account.
**Cause**: `auth.js registerWithPassword` had a literal list of 6 reserved
usernames. Every time a new `samomdkku*` staff account is added (per-VP,
new dept, future role) the list goes out of date. `reserved_staff_usernames`
is reference-only (0011 itself comments "not load-bearing"), so the only
defence is the username unique constraint *if* the row exists.
**Fix**: Use a prefix check — `/^samomdkku/.test(lc) || lc === 'sastaff'`.
The repo's convention is that ALL staff accounts share the `samomdkku`
prefix; literal lists shouldn't be added.
**Where**: `src/js/auth.js` `registerWithPassword`. Don't reintroduce
the literal list. If a future non-prefix staff username is needed,
extend the regex / OR clause — don't fall back to literals.

---

## iOS Safari `100vh` hides the bottom of a full-height drawer

**Symptom**: Sign-out button (or any bottom-anchored control) in the
mobile admin sidebar drawer was unreachable on iPhone — buried under
Safari's bottom URL chrome.
**Cause**: iOS Safari measures `100vh` against the *large viewport*
(URL bar hidden). When the URL bar is shown — which is the default
state on first open — the drawer extends *past* the visible area, and
the user has to scroll to reach the bottom. Adding `bottom: 0` on a
fixed element doesn't help: the element is positioned relative to the
same large viewport.
**Fix**: Use `100dvh` (dynamic viewport height) for the drawer height,
which shrinks when the chrome is shown. Keep `100vh` above it as a
fallback for browsers that don't grok `dvh`. Additionally pad the bottom
of the bottom-anchored control with
`max(0.85rem, calc(env(safe-area-inset-bottom) + 0.6rem))` so it sits
above the iOS home-indicator inset too.
**Where**: `src/css/workspace.css` `.workspace-side` (mobile @media block)
+ `.workspace-side-foot` (same block). Apply the same pattern to any
new full-height mobile overlay (offcanvas, modal-fullscreen on mobile).

---

## Pane-scoped DOM selectors break when the shell is rewritten

**Symptom**: In the admin app, clicking "การตั้งค่า" inside the หนังสือโครงการ
pane does nothing — the manage view never replaces the inbox view.
**Cause**: `setView()` in `src/js/projects/index.js` scoped its selectors
to `#pills-projects [data-projects-view]` / `[data-projects-pane]`, and
its click delegation listened on `#pills-projects`. The cc27157 public→
admin split removed the `id="pills-projects"` wrapper (tab-projects.html
now sits inside `<section data-admin-pane="projects">`), so every
scoped query found nothing and the click handler never bound.
**Fix**: Drop the `#pills-projects` scoping — the `data-projects-view`
/ `data-projects-pane` attributes are unique to this feature, so match
them at document scope. Delegate the click on `document` too.
**Where**: `src/js/projects/index.js` `setView()` + the `initProjects()`
click delegate. Whenever a refactor moves a partial into a new shell,
audit any module-scoped `#foo`-rooted query selectors against the new
DOM — the JS module's selector strings travel with the module and
will silently break if the host wrapper id changes.

---

## "Login is still there so the cache must be cleared" — localStorage and the HTTP cache are different buckets

**Symptom**: User reports a JS-level bug fixed on main, deploy is up
and `curl -I` confirms the new `Cache-Control: no-cache` header on
`/admin/`. User closes Safari, restarts iPad, comes back, sees they
are still signed in, and concludes "cache hasn't cleared" because
the JS fix still isn't visible.
**Cause**: Two different storage layers being confused.
- **localStorage** (`sb-<ref>-auth-token`, `samo.savedAccounts`,
  `projects.commentsSeenAt`, etc.) survives Safari restarts,
  device restarts, and tab closes. That's why the user is still
  signed in — completely independent of the HTTP cache.
- **HTTP cache** (the disk-cached copy of `/admin/index.html` and
  the JS bundle it references) is what carries the JS fix. iPad
  Safari keeps the cached HTML keyed by the cache headers that
  were on it AT THE TIME IT WAS CACHED — a later deploy that adds
  `Cache-Control: no-cache` only governs FUTURE fetches; it does
  NOT retroactively invalidate the cached copy.
So the iPad is happily serving stale HTML that points at the OLD
bundle hash, while the user sees "login still works → cache fine".
**Fix**: Three escalating options, in order:
1. Visit a fresh URL — `?v=2` or any querystring works because it's
   a different cache key. Verifies the new bundle without touching
   localStorage / signing out.
2. Settings → Safari → Advanced → Website Data → swipe-delete the
   entry for the site. iOS rolls localStorage into "Website Data"
   so this DOES sign the user out — fine, they re-sign-in.
3. Settings → Safari → Clear History and Website Data — last
   resort, nukes everything.
**Where it lives now**: `public/_headers` ships
`Cache-Control: no-cache, must-revalidate` on HTML so the NEXT
deploy after this fix won't re-trap a user, but the FIRST deploy
where this is added still requires one of the three steps above.
Pattern to recognise: any "fix shipped, deploy verified, user
still doesn't see it" report — first thing to check is whether
the user's HTML cache predates the `_headers` fix.

---

## CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import

**Symptom**: Every GitHub Actions `build` run (build.yml) fails in ~18s,
on `main` AND `refactor/modular`, for many commits in a row. Tests pass
locally. The CI log's failing step is `npm test`, with
`Error: Node.js 20 detected without native WebSocket support.` →
`Process completed with exit code 1`. The build step is never reached.
**Cause**: `@supabase/supabase-js` (^2.106.1) → realtime-js hard-throws at
**import time** when `globalThis.WebSocket` is absent. Node 20 has no
global WebSocket; Node 22 ships a stable one. At least one Vitest file
transitively imports `src/js/db.js` (which imports `@supabase/supabase-js`),
so the throw fires the moment Vitest loads that module — before any test
runs. Tests pass locally only because the dev machine runs Node 22+.
(`npm run build` is unaffected: Vite *bundles* db.js, it never *executes*
its module-level code in Node — the WebSocket check only runs at real
import, i.e. in the browser at runtime and in the Node test process.)
**Fix**: Bump `node-version` in `.github/workflows/build.yml` from `'20'`
to `'22'`. Also bumped README "Prerequisites" to Node 22+ so contributors
don't hit the same wall locally. Do NOT pin CI back to Node 20 while on
this supabase-js line. If a future need forces Node 20, the alternative is
to stop the test process importing db.js (isolate the pure-helper tests) or
polyfill `globalThis.WebSocket` in the Vitest setup — bumping Node is the
cleaner fix.
**Where**: `.github/workflows/build.yml` (`node-version: '22'`); `README.md`
Quick start prerequisites.

---

## Hard-deleting a row referenced by an `ON DELETE RESTRICT` FK fails 23503 — degrade to archive, don't surface the raw error

**Symptom**: Admin SAMO Shop → ลบสินค้า on a product that has been ordered
→ "ลบไม่สำเร็จ: {"code":"23503", ... "shop_order_items_product_id_fkey" ...}".
The raw PostgREST error JSON is dumped into the toast.
**Cause**: `shop_order_items.product_id references shop_products(id) ON DELETE
RESTRICT` (0003 schema) — deliberately protects order history. Any product
that appears in even one order can never be hard-deleted; PostgREST returns
Postgres error 23503 (the FK guard makes the DELETE a clean no-op, so nothing
is half-deleted). `deleteProduct` rethrew `error.message` raw (which, via
`dbRest`, is the whole PostgREST JSON body string — that's why the toast
showed JSON).
**Fix**: `shop_products` already has `is_active` + a read policy
`using (is_active OR current_user_is_shop_admin())`, so archiving (set
`is_active = false`) hides a product from the shop while keeping it visible to
admin and preserving every order FK. Same write RLS as DELETE
(`shop_products_write_admin` `for all`), so no auth change and no soft-delete-
RLS trap. `deleteProduct` now detects 23503 / the FK name and throws a typed
`PRODUCT_HAS_ORDERS` error; the admin click-handler offers a confirm to
`archiveProduct()` instead.
**Where**: `src/js/shop/api.js` (`deleteProduct` typed error +
`archiveProduct`), `src/js/shop/admin.js` (delete handler fallback). **Latent
parallel**: `project_documents.type_id references project_doc_types(id) ON
DELETE RESTRICT` (0005) is the same class — no UI deletes doc types today, but
if one is added, apply the same detect-23503-then-archive/block pattern.

// ==============================================
// BUILD-CHECK — self-healing stale-bundle reload
//
// Problem this exists to prevent:
//   Cloudflare deploys a new bundle (new content hash). The user's
//   browser keeps serving a cached copy of index.html that points
//   at the OLD bundle hash. Restarting the browser / the device
//   doesn't fix it because HTTP cache is keyed by URL, not by
//   session lifecycle. Worst-case: a fix the operator already
//   shipped doesn't reach a real user until they manually clear
//   their browser's Website Data. That's the "iPad highlights
//   still broken after the deploy" report.
//
// What this module does:
//   1. The vite buildIdPlugin stamps a fresh random id into every
//      build, both as a `__BUILD_ID__` constant baked into the JS
//      bundle AND as a /build.json static asset at the site root.
//   2. On page load — AND whenever the tab returns to the foreground — we
//      fetch /build.json with cache:'no-store' so the disk cache can't lie
//      about the latest deploy. The foreground re-check exists because a tab
//      left open across a deploy is the case that actually breaks (its lazy
//      `import()` chunks 404 once the old build is pruned) and a load-time-only
//      check never sees it: the page never loads again.
//   3. If the deployed buildId differs from our embedded one, the
//      HTML we're running is older than the latest deploy. Reload
//      with a `?_v=<deployed-id>` querystring — different URL ⇒
//      different cache key ⇒ fresh index.html ⇒ fresh bundle.
//   4. SessionStorage guards against any reload loop (we only try
//      once per deployed id, then give up if the new HTML still
//      doesn't match — that'd be a different bug).
//
// Why this is safe:
//   - No localStorage touched, so the user stays signed in across
//     the auto-reload.
//   - sessionStorage clears when the tab closes, so a new tab
//     gets a fresh chance to self-heal.
//   - The fetch failing (offline, dev without the middleware,
//     SSL hiccup) is swallowed silently — we'd rather skip the
//     check than punish a flaky network.
// ==============================================

// __BUILD_ID__ is replaced by vite's `define` at build time. In dev
// without the buildIdPlugin running, fall back to a sentinel so the
// equality check has something to compare to.
const EMBEDDED_BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const RELOAD_SENTINEL_KEY = 'samo.build.lastReloadFor';

export function startBuildCheck() {
  if (typeof window === 'undefined') return;
  checkOnce({ force: true });

  // A LONG-LIVED TAB never re-checks otherwise, and that is the case that
  // actually bites. Observed live 2026-07-30: a tab open across a deploy kept
  // working (its JS was already in memory) right up until it needed something
  // new, then broke — the user reported "the web is down" ~12 min after the
  // deploy and it "came back" only when they reloaded. A load-time-only check
  // cannot see that, because the page never loads again.
  //
  // Re-check when the tab comes back to the foreground: it is the moment the
  // user is about to interact, it costs one tiny no-store request, and it is
  // naturally rate-limited by the person's attention rather than a timer.
  // `pageshow` covers the bfcache restore, which fires no visibilitychange.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkOnce();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkOnce(); });
}

// Guard against two checks overlapping (visibilitychange and pageshow can both
// fire on a bfcache restore) — harmless, but it would double the request.
let inFlight = false;

/**
 * Is it safe to replace the page RIGHT NOW?
 *
 * At page load the answer is always yes — nothing is typed yet. On the
 * foreground re-check it is NOT: this app backgrounds constantly (go find a
 * photo, check an email) and the admin is full of modals holding unsaved text —
 * the member editor, the ปีการศึกษา archive editor, สร้างโครงการใหม่. Reloading
 * out from under one of those would destroy work the user had not saved, which
 * is a worse bug than the stale bundle it is trying to fix.
 *
 * So the foreground path only reloads when the page is idle: no open modal and
 * no text typed into any visible field. If it is not idle we simply skip — the
 * check runs again the next time the tab is foregrounded, by which point the
 * modal is usually closed.
 */
function pageIsIdle() {
  if (document.querySelector('.modal.show, .offcanvas.show')) return false;
  // type=search is excluded on purpose: a filter term left in a search box is
  // not unsaved WORK, but it would otherwise block the self-heal for as long as
  // it sits there. Same for anything explicitly marked transient.
  const fields = document.querySelectorAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search]):not([data-transient]),'
    + ' textarea:not([data-transient]), [contenteditable="true"]');
  for (const el of fields) {
    if (el.offsetParent === null) continue;                 // hidden — ignore
    const v = el.isContentEditable ? el.textContent : el.value;
    if (v && String(v).trim()) return false;
  }
  return true;
}

function checkOnce({ force = false } = {}) {
  if (inFlight) return;
  inFlight = true;
  // Fire-and-forget. Don't block anything else on the network round-
  // trip — the rest of the app can boot in parallel; the reload (if
  // any) replaces it before the user notices.
  fetch('/build.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((payload) => {
      const deployed = payload?.buildId;
      if (!deployed) return;
      if (deployed === EMBEDDED_BUILD_ID) return;

      // Loop guard: we already attempted a reload for this exact
      // deployed id. If we're back, the new HTML didn't update our
      // embedded id either — probably a different bug. Give up so
      // the user isn't trapped in an infinite reload.
      let alreadyTried = null;
      try { alreadyTried = sessionStorage.getItem(RELOAD_SENTINEL_KEY); } catch {}
      // Never yank the page out from under unsaved input (see pageIsIdle).
      // `force` is the page-load path, where nothing can be typed yet.
      if (!force && !pageIsIdle()) {
        console.info('[build-check] new build', deployed,
          '— deferring reload, the page has unsaved input or an open modal.');
        return;
      }

      if (alreadyTried === deployed) {
        console.warn('[build-check] embedded id', EMBEDDED_BUILD_ID,
          '!= deployed', deployed,
          '— giving up after one reload attempt to avoid a loop.');
        return;
      }
      try { sessionStorage.setItem(RELOAD_SENTINEL_KEY, deployed); } catch {}

      console.info('[build-check] stale bundle detected — reloading to', deployed);
      const url = new URL(window.location.href);
      url.searchParams.set('_v', deployed);
      window.location.replace(url.toString());
    })
    .catch(() => { /* offline / blocked — skip the check this load */ })
    .finally(() => { inFlight = false; });
}

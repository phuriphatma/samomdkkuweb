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
//   2. On page load, we fetch /build.json with cache:'no-store' so
//      the disk cache can't lie about the latest deploy.
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
    .catch(() => { /* offline / blocked — skip the check this load */ });
}

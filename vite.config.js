import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Inline-include partials at build time. Used by both entries.
function htmlPartials() {
  return {
    name: 'html-partials',
    transformIndexHtml(html) {
      return html.replace(/<include src="(.*)"\s*\/>/g, (match, src) => {
        const filePath = path.resolve(__dirname, src);
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, 'utf-8');
        }
        return match;
      });
    }
  };
}

// Stamp every build with a short id and emit it at /build.json. The
// runtime fetches build.json with no-store on every page load and
// compares it to the embedded __BUILD_ID__ — on mismatch it forces a
// cache-busting reload so a stale Safari HTML cache can never pin a
// user on an old bundle. See src/js/build-check.js.
function buildIdPlugin() {
  const buildId = crypto.randomBytes(6).toString('hex');
  // The release version travels WITH the build id. The id answers "is this tab
  // running the newest bundle"; the version answers "which release is deployed",
  // which is the question you actually ask when a user reports a bug. Read from
  // package.json so there is exactly one source of truth — see docs/VERSIONING.md.
  const version = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
  ).version;
  const payload = JSON.stringify({ buildId, version });
  return {
    name: 'build-id',
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(buildId),
          __APP_VERSION__: JSON.stringify(version),
        },
      };
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: payload });
    },
    // In dev, expose the same id through /build.json so build-check
    // never thinks dev is "stale" (it'd reload-loop otherwise).
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/build.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(payload);
          return;
        }
        next();
      });
    },
  };
}

// SPA fallback for dev. With multi-page input, Vite doesn't auto-rewrite
// arbitrary paths to a root entry, so /pr or /news/123 would 404 in dev.
// This middleware rewrites public-app paths to /index.html so the
// in-app router (main.js pathToTab) can resolve them. Mirrors the
// production Cloudflare _redirects.
function spaFallback() {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '/';
        // Pass through admin paths — they have their own entry.
        if (url.startsWith('/admin')) return next();
        // Skip Vite internals + static asset requests.
        if (url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/')) return next();
        if (url === '/' || url === '/index.html') return next();
        // Has a file extension (.js .css .png .ico .svg etc.) — leave alone.
        if (/\.[a-zA-Z0-9]{1,6}(\?|$)/.test(url)) return next();
        // Public SPA route — rewrite to root entry. The in-app router
        // reads location.pathname directly so the URL bar still shows /pr.
        req.url = '/';
        next();
      });
    },
  };
}

// Dev-only stand-in for the `/notify` service.
//
// In production `/notify` is a Node service on the VM (server/notify-server.mjs)
// wrapping functions/notify.js, and it holds the Discord webhook URLs as
// secrets. `npm run dev` has neither, so every notify POST used to fail — a
// 404 from Vite's SPA fallback, parsed as JSON, surfacing as a confusing error
// on a form that had actually saved fine.
//
// docs/TEAM-WORKFLOW.md §1: on LOCAL, Discord is "printed to the terminal".
// This is that. It NEVER forwards anywhere — a dev machine holding a real
// webhook URL is exactly what the service exists to avoid — so it cannot
// notify a real ฝ่าย channel by accident, which is the failure that matters.
//
// ⚠️ This is the DEV SERVER only. Preview builds on Cloudflare do not run
// vite.config.js at all; their Discord path is a dev webhook (#samo-dev-bot),
// which is phase 2 and not built.
function notifyDevStub() {
  return {
    name: 'notify-dev-stub',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/notify', (req, res, next) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, stub: true, note: 'dev stub — nothing is sent' }));
          return;
        }
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 1e6) { req.destroy(); }
        });
        req.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { /* print it raw below */ }
          const action = parsed?.action || '(no action)';
          console.log(`\n\u001b[33m[notify:dev]\u001b[0m ${action} — NOT SENT (dev stub)`);
          console.log(parsed ? JSON.stringify(parsed, null, 2).slice(0, 2000) : body.slice(0, 2000));
          res.setHeader('Content-Type', 'application/json');
          // Same success shape the real handler returns, so client code that
          // checks it takes the SAME branch it would in production.
          res.end(JSON.stringify({ success: true, stub: true }));
        });
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [notifyDevStub(), buildIdPlugin(), htmlPartials(), spaFallback()],
  build: {
    outDir: 'dist',
    // Multi-page build — public site at /, operator app at /admin/.
    // Same Supabase, same Cloudflare project; two bundles so public
    // visitors don't download admin code. Pattern follows Stripe /
    // Vercel / Linear: public marketing + dedicated operator app.
    rollupOptions: {
      input: {
        public: path.resolve(__dirname, 'index.html'),
        admin:  path.resolve(__dirname, 'admin/index.html'),
      },
    },
  },
  server: {
    port: 5174,
    open: true,
  },
});

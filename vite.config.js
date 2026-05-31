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
  return {
    name: 'build-id',
    config() {
      return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: JSON.stringify({ buildId }),
      });
    },
    // In dev, expose the same id through /build.json so build-check
    // never thinks dev is "stale" (it'd reload-loop otherwise).
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/build.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ buildId }));
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

export default defineConfig({
  root: '.',
  plugins: [buildIdPlugin(), htmlPartials(), spaFallback()],
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

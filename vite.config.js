import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

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

export default defineConfig({
  root: '.',
  plugins: [htmlPartials()],
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

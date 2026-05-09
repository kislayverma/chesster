import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the flat repo layout (post Phase 1.5).
// For local end-to-end development including `/api/*` serverless functions,
// run `vercel dev` instead of `npm run dev` — it starts both the Vite dev
// server and the functions under `api/` with production-equivalent routing.
// When running plain `npm run dev`, `/api/*` calls will fail and the coach
// falls back to template/rule mode automatically per DESIGN.md §6.

/**
 * At build time, rewrite OG image URLs in index.html to absolute URLs
 * so social-media crawlers (WhatsApp, Facebook, Twitter/X) can resolve
 * the preview image. Falls back to VERCEL_PROJECT_PRODUCTION_URL when
 * VITE_BASE_URL isn't set (Vercel injects the former automatically).
 */
function ogAbsoluteUrls(): Plugin {
  return {
    name: 'og-absolute-urls',
    transformIndexHtml(html) {
      const base =
        process.env.VITE_BASE_URL ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : '');
      if (!base) return html;
      return html.replace(
        /content="\/og-image\.png"/g,
        `content="${base}/og-image.png"`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), ogAbsoluteUrls()],
  server: {
    port: 5173,
  },
});

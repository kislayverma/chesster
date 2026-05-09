import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the flat repo layout (post Phase 1.5).
// For local end-to-end development including `/api/*` serverless functions,
// run `vercel dev` instead of `npm run dev` — it starts both the Vite dev
// server and the functions under `api/` with production-equivalent routing.
// When running plain `npm run dev`, `/api/*` calls will fail and the coach
// falls back to template/rule mode automatically per DESIGN.md §6.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});

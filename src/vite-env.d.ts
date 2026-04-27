/// <reference types="vite/client" />

/**
 * Vite build-time env vars available on `import.meta.env`. Only
 * variables prefixed with `VITE_` are exposed to the client bundle.
 * Server-only variables (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
 * etc.) live in the serverless function runtime and must NOT be added
 * here — exposing them would risk baking them into the static build.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_GA4_MEASUREMENT_ID?: string;
  readonly VITE_MIXPANEL_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

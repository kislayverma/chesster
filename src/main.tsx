import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { useProfileStore } from './profile/profileStore';
import { initLlmMode } from './lib/featureFlags';
import { useAuthStore } from './auth/authStore';
import { initSyncOrchestrator } from './sync/syncOrchestrator';

// Kick off profile hydration before the first render so the dashboard
// doesn't flash an empty state on reload. The store starts in a
// "not hydrated" mode and pages that care render a loading placeholder
// until this resolves.
void useProfileStore.getState().hydrate();

// Phase 7: hydrate the BYOK key from IndexedDB and probe /api/health
// so the NavShell LLM badge and the coach/tagger know whether to use
// Claude or fall back to templates. Best-effort, 800ms timeout — if
// the proxy is unavailable we silently downgrade to 'off'.
void initLlmMode();

// Phase 9: wire up the sync orchestrator BEFORE initializing the auth
// store so the onSignIn handler is registered by the time the first
// INITIAL_SESSION event fires. `authStore.initialize()` is idempotent
// and short-circuits on unconfigured deployments.
initSyncOrchestrator();
void useAuthStore.getState().initialize();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

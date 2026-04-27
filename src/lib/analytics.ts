/**
 * Unified analytics module — wraps Google Analytics 4 and Mixpanel
 * behind a single API so the rest of the app doesn't need to know
 * which providers are active.
 *
 * Both providers are optional: if the env var for a provider is
 * missing the corresponding calls silently no-op.
 *
 * Usage:
 *   import { initAnalytics, trackEvent, trackPageView, identify, resetAnalytics } from '../lib/analytics';
 *
 *   // Once, before first render (main.tsx):
 *   initAnalytics();
 *
 *   // On every route change:
 *   trackPageView('/play');
 *
 *   // Custom events:
 *   trackEvent('game_finished', { result: '1-0', rating: 1450 });
 *
 *   // After authentication:
 *   identify('user-uuid', { level: 'clubPlayer', rating: 1400 });
 *
 *   // After sign-out:
 *   resetAnalytics();
 */

import mixpanel from 'mixpanel-browser';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let ga4Id: string | null = null;
let mixpanelReady = false;

// Extend the Window type for gtag
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Bootstrap both analytics providers.  Safe to call multiple times —
 * subsequent calls are no-ops.
 */
export function initAnalytics(): void {
  // ── GA4 ──
  const gaMeasurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID;
  if (gaMeasurementId && !ga4Id) {
    ga4Id = gaMeasurementId;
    // Inject the gtag.js script dynamically so we don't need to touch
    // index.html and the app still works when the env var is absent.
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ga4Id}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', ga4Id, {
      send_page_view: false, // we manage page-views manually via trackPageView
    });
  }

  // ── Mixpanel ──
  const mpToken = import.meta.env.VITE_MIXPANEL_TOKEN;
  if (mpToken && !mixpanelReady) {
    mixpanel.init(mpToken, {
      track_pageview: false, // manual
      persistence: 'localStorage',
    });
    mixpanelReady = true;
  }
}

// ---------------------------------------------------------------------------
// Page-view tracking
// ---------------------------------------------------------------------------

/** Send a page-view to both providers. Call on every React Router navigation. */
export function trackPageView(path: string): void {
  if (ga4Id) {
    window.gtag('event', 'page_view', {
      page_path: path,
    });
  }
  if (mixpanelReady) {
    mixpanel.track('$mp_web_page_view', { path });
  }
}

// ---------------------------------------------------------------------------
// Custom event tracking
// ---------------------------------------------------------------------------

/** Track a named event with optional properties. */
export function trackEvent(
  name: string,
  properties?: Record<string, unknown>,
): void {
  if (ga4Id) {
    window.gtag('event', name, properties ?? {});
  }
  if (mixpanelReady) {
    mixpanel.track(name, properties ?? {});
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Associate future events with a known user id.  Call after authentication.
 * `traits` become Mixpanel "super properties" + "people properties" so they
 * auto-attach to every subsequent event and enable segmentation.
 */
export function identify(
  userId: string,
  traits?: Record<string, unknown>,
): void {
  if (ga4Id) {
    window.gtag('set', 'user_properties', {
      user_id: userId,
      ...traits,
    });
    window.gtag('config', ga4Id, { user_id: userId });
  }
  if (mixpanelReady) {
    mixpanel.identify(userId);
    if (traits) {
      mixpanel.people.set(traits);
      mixpanel.register(traits);
    }
  }
}

/** Clear identity on sign-out. */
export function resetAnalytics(): void {
  if (mixpanelReady) {
    mixpanel.reset();
  }
  // GA4 doesn't have a built-in reset; a page reload effectively clears
  // the in-memory user_id.
}

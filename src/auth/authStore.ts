/**
 * Phase 9 auth store.
 *
 * Holds the current Supabase session/user and exposes the imperative
 * actions the pages need: `signInWithEmail`, `signOut`, and
 * `initialize` (called once on app boot from `main.tsx`).
 *
 * Architecture:
 *
 *   • The session is the single source of truth. Everything else
 *     (profile sync, game sync, NavShell badge, protected routes)
 *     subscribes to `useAuthStore` and reacts.
 *
 *   • `initialize()` wires `supabase.auth.onAuthStateChange` exactly
 *     once and then calls `getSession()` so subsequent full-page
 *     reloads come back logged in without a flicker.
 *
 *   • When the session flips from `null` to a user, we fire a
 *     one-shot `handleSignIn` callback that downloads remote data
 *     into the local stores. That logic lives in `sync/syncOrchestrator.ts`
 *     so this store stays small and testable.
 *
 *   • When Supabase is not configured at build time (Phase 8 deploy),
 *     `initialize()` short-circuits to `status: 'unconfigured'` and
 *     every action becomes a no-op. Pages render a "sync is disabled
 *     for this deployment" hint instead of a blank login form.
 */

import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '../sync/supabaseClient';

export type AuthStatus =
  | 'loading'        // Initial state, before `initialize()` resolves.
  | 'anonymous'      // No session, but Supabase IS configured.
  | 'authenticated'  // `session.user` is present.
  | 'unconfigured';  // Build shipped without VITE_SUPABASE_* — sync off.

interface AuthStore {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /**
   * Set by `sync/syncOrchestrator` right before it starts downloading
   * remote data after sign-in, and cleared when the download resolves.
   * Exposed so the NavShell / LoginPage can show a spinner.
   */
  syncing: boolean;
  /**
   * Last non-fatal auth error, e.g. "rate limit exceeded" from the
   * magic-link send. Cleared automatically when `signInWithEmail`
   * starts a new attempt.
   */
  lastError: string | null;

  initialize: () => Promise<void>;
  signInWithEmail: (email: string, redirectTo?: string) => Promise<boolean>;
  signOut: () => Promise<void>;

  /** Internal — called by the auth-state-change subscription. */
  _setSession: (session: Session | null) => void;
  _setSyncing: (busy: boolean) => void;
}

let initialized = false;
let onSignInHandler: ((session: Session) => Promise<void> | void) | null = null;
let onSignOutHandler: (() => Promise<void> | void) | null = null;

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  syncing: false,
  lastError: null,

  initialize: async () => {
    if (initialized) return;
    initialized = true;

    const supabase = getSupabase();
    if (!supabase) {
      set({ status: 'unconfigured' });
      return;
    }

    // Hook the auth state change BEFORE the initial getSession so we
    // don't miss the very first INITIAL_SESSION event.
    supabase.auth.onAuthStateChange((_event, session) => {
      const prevUserId = get().user?.id ?? null;
      get()._setSession(session);
      const nextUserId = session?.user.id ?? null;
      if (
        session &&
        nextUserId &&
        nextUserId !== prevUserId &&
        onSignInHandler
      ) {
        void Promise.resolve(onSignInHandler(session)).catch((err) => {
          console.warn('[authStore] onSignInHandler error', err);
        });
      }
      if (!nextUserId && prevUserId && onSignOutHandler) {
        void Promise.resolve(onSignOutHandler()).catch((err) => {
          console.warn('[authStore] onSignOutHandler error', err);
        });
      }
    });

    try {
      const { data } = await supabase.auth.getSession();
      get()._setSession(data.session);
      if (data.session && onSignInHandler) {
        void Promise.resolve(onSignInHandler(data.session)).catch((err) => {
          console.warn('[authStore] onSignInHandler error', err);
        });
      }
    } catch (err) {
      console.warn('[authStore] getSession failed', err);
      set({ status: 'anonymous' });
    }
  },

  signInWithEmail: async (email, redirectTo) => {
    const supabase = getSupabase();
    if (!supabase) {
      set({ lastError: 'Sync is not configured on this deployment.' });
      return false;
    }
    set({ lastError: null });
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (error) {
        set({ lastError: error.message });
        return false;
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      set({ lastError: msg });
      return false;
    }
  },

  signOut: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[authStore] signOut failed', err);
    }
  },

  _setSession: (session) => {
    if (session) {
      set({
        status: 'authenticated',
        session,
        user: session.user,
      });
    } else {
      set({
        status: isSupabaseConfigured() ? 'anonymous' : 'unconfigured',
        session: null,
        user: null,
      });
    }
  },

  _setSyncing: (busy) => set({ syncing: busy }),
}));

/**
 * Register the callback fired immediately after a user signs in. Set
 * by `sync/syncOrchestrator.ts` at module load — stays idempotent
 * because only one handler is active at a time.
 */
export function setOnSignInHandler(
  handler: (session: Session) => Promise<void> | void
): void {
  onSignInHandler = handler;
}

/**
 * Register the callback fired immediately after a sign-out. Used to
 * flip the coach / remote stores back to local-only mode.
 */
export function setOnSignOutHandler(
  handler: () => Promise<void> | void
): void {
  onSignOutHandler = handler;
}

/** Read the current user id without subscribing (for non-React code). */
export function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

/** True when there is an active Supabase session. */
export function isAuthenticated(): boolean {
  return useAuthStore.getState().status === 'authenticated';
}

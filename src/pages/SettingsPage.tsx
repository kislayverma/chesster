/**
 * Phase 10 SettingsPage — BYOK key management + engine defaults +
 * data management.
 *
 * Three cards:
 *   1. Anthropic API key (BYOK) — carried over from Phase 7.
 *   2. Engine defaults — skill level and search depth for new games.
 *   3. Data management — export profile as JSON, clear all local data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  clearByokKey,
  hasByokKey,
  hydrateByokKey,
  looksLikeAnthropicKey,
  setByokKey,
} from '../lib/byokStorage';
import {
  getLlmMode,
  isByokInvalid,
  markServerModeByokOnly,
  subscribeLlmMode,
  type LlmMode,
} from '../lib/featureFlags';
import localforage from 'localforage';
import { useGameStore } from '../game/gameStore';
import { useProfileStore } from '../profile/profileStore';
import { listGames } from '../game/gameStorage';

const MODE_LABELS: Record<LlmMode, string> = {
  off: 'LLM: off',
  'byok-only': 'LLM: BYOK',
  'free-tier': 'LLM: free tier',
};

const MODE_DESCRIPTIONS: Record<LlmMode, string> = {
  off: 'Coach feedback is using rule-based templates only. Add an Anthropic API key below to upgrade explanations.',
  'byok-only':
    'Coach is using your Anthropic key. Explanations and motif tagging are powered by Claude; you pay Anthropic directly.',
  'free-tier':
    'Coach is using a shared, rate-limited LLM quota provided by this deployment.',
};

export default function SettingsPage() {
  const [mode, setMode] = useState<LlmMode>(getLlmMode());
  const [keyPresent, setKeyPresent] = useState<boolean>(false);
  const [invalid, setInvalid] = useState<boolean>(isByokInvalid());
  const [input, setInput] = useState<string>('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  // Hydrate whether a key is already stored (shows "Key saved" badge
  // without ever revealing the key itself).
  useEffect(() => {
    let mounted = true;
    hydrateByokKey().then(() => {
      if (mounted) setKeyPresent(hasByokKey());
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Live LLM mode + invalid-key state updates.
  useEffect(() => {
    return subscribeLlmMode((m) => {
      setMode(m);
      setInvalid(isByokInvalid());
      setKeyPresent(hasByokKey());
    });
  }, []);

  const onSave = async () => {
    const candidate = input.trim();
    if (candidate.length === 0) {
      setStatus('Paste an Anthropic API key first.');
      return;
    }
    if (!looksLikeAnthropicKey(candidate)) {
      setStatus('That does not look like an Anthropic key (expected prefix "sk-ant-"). Save anyway?');
      // Don't hard-block — some users may have future key formats.
    }
    setBusy(true);
    try {
      await setByokKey(candidate);
      // Optimistically promote the server mode: if /api/health is not
      // reachable (e.g. `npm run dev`), the coach will silently fall
      // back to templates on LLM failure, which is correct behavior.
      markServerModeByokOnly();
      setInput('');
      setStatus('Key saved. Play a move to see Claude-powered coaching.');
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await clearByokKey();
      setInput('');
      setStatus('Key removed. Coach fell back to rule-based templates.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Current mode:{' '}
          <span className="font-mono text-slate-200">{MODE_LABELS[mode]}</span>
        </p>
      </header>

      <section className="w-full rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg font-semibold text-slate-100">Anthropic API key (BYOK)</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {MODE_DESCRIPTIONS[mode]}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Your key is sent as a per-request header and is never logged or shared
          with any third party.
        </p>

        {invalid && (
          <div
            role="alert"
            className="mt-4 rounded border border-rose-500/60 bg-rose-900/30 p-3 text-sm text-rose-100"
          >
            Anthropic rejected your key (HTTP&nbsp;401). Paste a new key below to
            re-enable Claude-powered coaching.
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-[11px] uppercase tracking-wider ${
              keyPresent
                ? 'bg-emerald-900/40 text-emerald-200'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {keyPresent ? 'Key saved' : 'No key'}
          </span>
          {keyPresent && (
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200 disabled:opacity-40"
            >
              Remove key
            </button>
          )}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {keyPresent ? 'Replace key' : 'Paste key'}
          </span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
          />
        </label>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={busy || input.trim().length === 0}
            className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save key
          </button>
          {status && (
            <span className="text-xs text-slate-400">{status}</span>
          )}
        </div>

        <details className="mt-5 text-xs text-slate-500">
          <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-300">
            How to get an Anthropic API key
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-snug">
            <li>
              Create an account at{' '}
              <span className="font-mono text-slate-400">console.anthropic.com</span>.
            </li>
            <li>Go to Settings → API Keys and click "Create Key".</li>
            <li>Copy the full key (it starts with <code>sk-ant-</code>) and paste it here.</li>
            <li>You are billed by Anthropic for each coach explanation — typical cost is fractions of a cent per move.</li>
          </ol>
        </details>
      </section>

      {/* ─── Engine Defaults ─────────────────────────────────── */}
      <EngineDefaultsCard />

      {/* ─── Data Management ─────────────────────────────────── */}
      <DataManagementCard />
    </main>
  );
}

/**
 * Card for setting the default Stockfish skill level for new games.
 */
function EngineDefaultsCard() {
  const skillLevel = useGameStore((s) => s.skillLevel);
  const setSkillLevel = useGameStore((s) => s.setSkillLevel);

  return (
    <section className="w-full rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-lg font-semibold text-slate-100">Engine defaults</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        These settings apply to the current and future games on this device.
      </p>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          <span>Stockfish skill level</span>
          <span className="font-mono tabular-nums text-slate-200">
            {skillLevel}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={skillLevel}
          onChange={(e) => setSkillLevel(parseInt(e.target.value, 10))}
          className="w-full accent-slate-400"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>0 (beginner)</span>
          <span>20 (strongest)</span>
        </div>
      </div>
    </section>
  );
}

/**
 * Card for exporting data and clearing local storage.
 */
function DataManagementCard() {
  const profile = useProfileStore((s) => s.profile);
  const clearProfile = useProfileStore((s) => s.clearProfile);
  const [gameCount, setGameCount] = useState<number | null>(null);

  useEffect(() => {
    void listGames().then((g) => setGameCount(g.length));
  }, []);

  const exportProfile = useCallback(() => {
    const json = JSON.stringify(profile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chesster-profile-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [profile]);

  const clearAll = useCallback(async () => {
    if (
      !confirm(
        'This will permanently delete your profile and all saved games from this browser. Continue?',
      )
    ) {
      return;
    }
    clearProfile();
    // Clear all localforage entries (games + index).
    try {
      await localforage.clear();
    } catch {
      // Best effort.
    }
    setGameCount(0);
  }, [clearProfile]);

  return (
    <section className="w-full rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-lg font-semibold text-slate-100">Data management</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        Your profile and games are always available. Sign in to sync across devices.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={exportProfile}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          Export profile (JSON)
        </button>

        <span className="text-xs text-slate-500">
          {gameCount != null ? `${gameCount} saved game${gameCount !== 1 ? 's' : ''}` : '...'}
        </span>
      </div>

      <div className="mt-4 border-t border-slate-800 pt-4">
        <button
          type="button"
          onClick={() => void clearAll()}
          className="rounded border border-rose-500/40 bg-rose-900/20 px-4 py-1.5 text-sm text-rose-300 hover:bg-rose-900/40"
        >
          Clear all local data
        </button>
        <p className="mt-1 text-xs text-slate-500">
          Permanently removes your profile, saved games, and API key.
        </p>
      </div>
    </section>
  );
}

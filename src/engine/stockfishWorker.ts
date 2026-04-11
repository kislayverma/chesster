/**
 * Phase 2 Stockfish worker bootstrap.
 *
 * We use the single-threaded lite build vendored into `public/stockfish/`
 * by `scripts/vendor-stockfish.mjs`. The single-threaded variant avoids
 * SharedArrayBuffer and therefore works without cross-origin isolation
 * headers (COOP/COEP), which keeps Vercel deployment trivial.
 *
 * This module is a thin singleton wrapper:
 *   • it lazily constructs one Web Worker per browser session
 *   • it exposes send(cmd) to post raw UCI strings
 *   • it exposes subscribe(fn) to receive every line the engine prints
 *
 * analysis.ts builds the high-level analyzePosition() API on top of it.
 */

const WORKER_URL = '/stockfish/stockfish-18-lite-single.js';

type Listener = (line: string) => void;

let worker: Worker | null = null;
const listeners = new Set<Listener>();

function ensureWorker(): Worker {
  if (worker) return worker;

  // Classic worker — stockfish.js is already packaged as a worker-ready
  // script; it expects to be instantiated via `new Worker(url)` and will
  // handle postMessage / onmessage internally.
  worker = new Worker(WORKER_URL);

  worker.onmessage = (e: MessageEvent<string>) => {
    const data = e.data;
    if (typeof data !== 'string') return;
    for (const fn of listeners) fn(data);
  };

  worker.onerror = (e) => {
    // Surface worker boot / runtime errors to the console; analysis.ts
    // will time out pending requests on its own.
    console.error('[stockfish] worker error', e.message || e);
  };

  return worker;
}

/** Post a raw UCI command line to the engine. */
export function send(cmd: string): void {
  ensureWorker().postMessage(cmd);
}

/** Subscribe to every line the engine prints. Returns an unsubscribe fn. */
export function subscribe(fn: Listener): () => void {
  ensureWorker();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Terminate the worker. Only used by tests / hot reload. */
export function terminate(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  listeners.clear();
}

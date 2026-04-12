/**
 * Phase 6 warm-up prompt.
 *
 * Rendered at the top of `PlayPage` when there are SRS cards due.
 * Dismissible within the session; reappears on the next page load.
 */

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { usePracticeStore } from '../srs/practiceStore';

export default function PracticePrompt() {
  const dueCount = usePracticeStore((s) => s.dueCount());
  const hydrated = usePracticeStore((s) => s.hydrated);
  const [dismissed, setDismissed] = useState(false);

  if (!hydrated || dueCount === 0 || dismissed) return null;

  return (
    <div className="flex items-center justify-between rounded border border-amber-800/40 bg-amber-900/20 px-4 py-2 text-sm">
      <span className="text-amber-200">
        You have <strong>{dueCount}</strong> drill{dueCount !== 1 ? 's' : ''}{' '}
        due. Warm up before playing?
      </span>
      <div className="flex gap-2">
        <NavLink
          to="/practice"
          className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-slate-950 hover:bg-amber-500"
        >
          Start drills
        </NavLink>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

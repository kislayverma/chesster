/**
 * Phase 6 SRS types.
 *
 * A `PracticeCard` is a flashcard derived from a `WeaknessEvent`.
 * The player sees the board at `fen` and must find the engine's
 * `bestMove`. SM-2 fields (`easeFactor`, `intervalDays`, `dueAt`,
 * `lapses`) drive the scheduling — see `scheduler.ts`.
 */

export interface PracticeCard {
  /** Stable UUID. */
  id: string;
  /** Links back to the originating WeaknessEvent. */
  eventId: string;
  /** FEN of the position BEFORE the player's mistake. */
  fen: string;
  /** SAN of the engine's recommended move — the correct answer. */
  bestMove: string;
  /** Motif ids copied from the source event (for UI display). */
  motifs: string[];
  /** SM-2 ease factor (default 2.5). */
  easeFactor: number;
  /** Days until next review (0 = new/lapsed). */
  intervalDays: number;
  /** Epoch ms when the card becomes due. */
  dueAt: number;
  /** Number of times the player answered incorrectly. */
  lapses: number;
  /** Epoch ms when the card was first created. */
  createdAt: number;
}

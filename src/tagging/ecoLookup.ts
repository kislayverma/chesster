/**
 * Phase 12 ECO lookup.
 *
 * Classifies the opening by matching the game's move sequence against
 * a compact inline ECO database. Returns the most specific (longest)
 * match. Covers the ~120 most common openings — enough to label
 * > 90 % of games at the club level.
 *
 * The `isBookMove` helper determines whether a move at a given ply
 * should be classified as `book` (skipping cpLoss evaluation). It
 * checks whether the position after the move still matches a known
 * opening line. The threshold is configurable but defaults to ply 16
 * (move 8 for each side).
 */

export interface EcoEntry {
  eco: string;
  name: string;
}

/**
 * Database keyed by space-separated SAN move sequence from the
 * starting position. Entries are ordered shortest → longest prefix;
 * `lookupEco` returns the longest match.
 *
 * Sources: compiled from the standard ECO classification tables
 * (public domain). Only the most frequently played lines are
 * included to keep the bundle tiny (~4 KB gzipped).
 */
const ECO_DB: Array<[string, string, string]> = [
  // A: Flank openings
  ['1. Nf3', 'A04', 'Reti Opening'],
  ['1. Nf3 d5 2. c4', 'A09', 'Reti Opening'],
  ['1. c4', 'A10', 'English Opening'],
  ['1. c4 e5', 'A20', 'English Opening'],
  ['1. c4 e5 2. Nc3', 'A25', 'English Opening: Sicilian Reversed'],
  ['1. c4 c5', 'A30', 'English Opening: Symmetrical'],
  ['1. c4 Nf6', 'A15', 'English Opening: Anglo-Indian'],
  ['1. d4 Nf6 2. c4 e6 3. Nf3', 'A46', 'Indian Defense'],
  ['1. d4 Nf6 2. Nf3', 'A48', 'London System'],
  ['1. d4 Nf6 2. Nf3 g6 3. Bf4', 'A48', 'London System'],
  ['1. d4 d5 2. Nf3 Nf6 3. Bf4', 'A46', 'London System'],
  ['1. g3', 'A00', "Benko's Opening"],
  ['1. b3', 'A01', 'Nimzo-Larsen Attack'],
  ['1. f4', 'A02', "Bird's Opening"],

  // B: Semi-open games (1. e4, not 1...e5)
  ['1. e4 c5', 'B20', 'Sicilian Defense'],
  ['1. e4 c5 2. Nf3', 'B27', 'Sicilian Defense'],
  ['1. e4 c5 2. Nf3 d6', 'B50', 'Sicilian Defense'],
  ['1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3', 'B90', 'Sicilian Najdorf'],
  ['1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6', 'B90', 'Sicilian Najdorf'],
  ['1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6', 'B76', 'Sicilian Dragon'],
  ['1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e5', 'B97', 'Sicilian Sveshnikov'],
  ['1. e4 c5 2. Nf3 Nc6', 'B30', 'Sicilian Defense'],
  ['1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4', 'B44', 'Sicilian Defense: Open'],
  ['1. e4 c5 2. Nf3 e6', 'B40', 'Sicilian Defense'],
  ['1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4', 'B45', 'Sicilian Defense: Taimanov'],
  ['1. e4 c5 2. d4', 'B21', 'Sicilian Smith-Morra Gambit'],
  ['1. e4 c5 2. Nc3', 'B23', 'Sicilian Closed'],
  ['1. e4 c6', 'B10', 'Caro-Kann Defense'],
  ['1. e4 c6 2. d4 d5', 'B12', 'Caro-Kann Defense'],
  ['1. e4 c6 2. d4 d5 3. Nc3', 'B15', 'Caro-Kann Defense: Main Line'],
  ['1. e4 c6 2. d4 d5 3. e5', 'B12', 'Caro-Kann Defense: Advance'],
  ['1. e4 c6 2. d4 d5 3. exd5 cxd5', 'B13', 'Caro-Kann Defense: Exchange'],
  ['1. e4 d5', 'B01', 'Scandinavian Defense'],
  ['1. e4 d5 2. exd5 Qxd5', 'B01', 'Scandinavian Defense'],
  ['1. e4 d6', 'B06', 'Pirc Defense'],
  ['1. e4 d6 2. d4 Nf6 3. Nc3', 'B07', 'Pirc Defense: Classical'],
  ['1. e4 Nf6', 'B02', 'Alekhine Defense'],
  ['1. e4 g6', 'B06', 'Modern Defense'],
  ['1. e4 e6', 'B40', 'French Defense'],

  // C: Open games (1. e4 e5)
  ['1. e4 e5', 'C20', "King's Pawn Game"],
  ['1. e4 e5 2. Nf3', 'C40', "King's Knight Opening"],
  ['1. e4 e5 2. Nf3 Nc6', 'C44', "King's Pawn Game"],
  ['1. e4 e5 2. Nf3 Nc6 3. Bb5', 'C60', 'Ruy Lopez'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bb5 a6', 'C68', 'Ruy Lopez: Morphy Defense'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4', 'C70', 'Ruy Lopez: Morphy Defense'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O', 'C78', 'Ruy Lopez: Morphy Defense'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6', 'C65', 'Ruy Lopez: Berlin Defense'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bc4', 'C50', 'Italian Game'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5', 'C50', 'Italian Game: Giuoco Piano'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3', 'C54', 'Italian Game: Classical'],
  ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6', 'C55', 'Italian Game: Two Knights Defense'],
  ['1. e4 e5 2. Nf3 Nc6 3. d4', 'C44', 'Scotch Game'],
  ['1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4', 'C45', 'Scotch Game'],
  ['1. e4 e5 2. Nf3 Nf6', 'C42', 'Petrov Defense'],
  ['1. e4 e5 2. Nf3 Nf6 3. Nxe5', 'C42', 'Petrov Defense: Classical'],
  ['1. e4 e5 2. Nf3 d6', 'C41', 'Philidor Defense'],
  ['1. e4 e5 2. d4', 'C21', 'Center Game'],
  ['1. e4 e5 2. Bc4', 'C23', "Bishop's Opening"],
  ['1. e4 e5 2. f4', 'C30', "King's Gambit"],
  ['1. e4 e5 2. f4 exf4', 'C33', "King's Gambit Accepted"],
  ['1. e4 e5 2. Nc3', 'C25', 'Vienna Game'],

  // C: French Defense
  ['1. e4 e6 2. d4', 'C00', 'French Defense'],
  ['1. e4 e6 2. d4 d5', 'C00', 'French Defense'],
  ['1. e4 e6 2. d4 d5 3. Nc3', 'C03', 'French Defense: Tarrasch'],
  ['1. e4 e6 2. d4 d5 3. Nc3 Nf6', 'C05', 'French Defense: Classical'],
  ['1. e4 e6 2. d4 d5 3. Nc3 Bb4', 'C15', 'French Defense: Winawer'],
  ['1. e4 e6 2. d4 d5 3. Nd2', 'C01', 'French Defense: Tarrasch'],
  ['1. e4 e6 2. d4 d5 3. e5', 'C02', 'French Defense: Advance'],
  ['1. e4 e6 2. d4 d5 3. exd5 exd5', 'C01', 'French Defense: Exchange'],

  // D: Closed games (1. d4 d5)
  ['1. d4', 'A40', "Queen's Pawn Game"],
  ['1. d4 d5', 'D00', "Queen's Pawn Game"],
  ['1. d4 d5 2. c4', 'D06', "Queen's Gambit"],
  ['1. d4 d5 2. c4 e6', 'D30', "Queen's Gambit Declined"],
  ['1. d4 d5 2. c4 e6 3. Nc3', 'D31', "Queen's Gambit Declined"],
  ['1. d4 d5 2. c4 e6 3. Nc3 Nf6', 'D35', "Queen's Gambit Declined: Three Knights"],
  ['1. d4 d5 2. c4 e6 3. Nf3 Nf6', 'D37', "Queen's Gambit Declined"],
  ['1. d4 d5 2. c4 dxc4', 'D20', "Queen's Gambit Accepted"],
  ['1. d4 d5 2. c4 c6', 'D10', 'Slav Defense'],
  ['1. d4 d5 2. c4 c6 3. Nf3 Nf6', 'D11', 'Slav Defense'],
  ['1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3', 'D15', 'Slav Defense: Main Line'],
  ['1. d4 d5 2. Nf3', 'D02', "Queen's Pawn Game"],
  ['1. d4 d5 2. Bf4', 'D00', 'London System'],
  ['1. d4 d5 2. e3', 'D02', "Queen's Pawn Game: Colle System"],

  // E: Indian defenses (1. d4 Nf6)
  ['1. d4 Nf6', 'A45', 'Indian Defense'],
  ['1. d4 Nf6 2. c4', 'A50', 'Indian Defense'],
  ['1. d4 Nf6 2. c4 g6', 'E60', "King's Indian Defense"],
  ['1. d4 Nf6 2. c4 g6 3. Nc3 Bg7', 'E61', "King's Indian Defense"],
  ['1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6', 'E70', "King's Indian Defense: Main Line"],
  ['1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O', 'E90', "King's Indian Defense: Classical"],
  ['1. d4 Nf6 2. c4 g6 3. Nc3 d5', 'D70', 'Gruenfeld Defense'],
  ['1. d4 Nf6 2. c4 g6 3. Nc3 d5 4. cxd5 Nxd5', 'D85', 'Gruenfeld Defense: Exchange'],
  ['1. d4 Nf6 2. c4 e6', 'E00', 'Indian Defense'],
  ['1. d4 Nf6 2. c4 e6 3. Nc3 Bb4', 'E20', 'Nimzo-Indian Defense'],
  ['1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3', 'E40', 'Nimzo-Indian Defense: Rubinstein'],
  ['1. d4 Nf6 2. c4 e6 3. Nf3 b6', 'E10', 'Queen\'s Indian Defense'],
  ['1. d4 Nf6 2. c4 e6 3. Nf3 d5', 'D37', "Queen's Gambit Declined"],
  ['1. d4 Nf6 2. c4 e6 3. g3', 'E01', 'Catalan Opening'],
  ['1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2', 'E04', 'Catalan Opening'],
  ['1. d4 Nf6 2. c4 c5', 'A57', 'Benko Gambit'],
  ['1. d4 Nf6 2. c4 c5 3. d5 b5', 'A57', 'Benko Gambit'],
  ['1. d4 Nf6 2. Bf4', 'A45', 'London System'],
  ['1. d4 d6', 'A41', 'Old Indian Defense'],

  // Misc
  ['1. d4 f5', 'A80', 'Dutch Defense'],
  ['1. d4 f5 2. c4', 'A82', 'Dutch Defense'],
];

/**
 * Pre-processed lookup: keyed by normalised SAN sequence (without
 * move numbers and ellipsis), valued by ECO + name. Built once at
 * module load.
 */
interface IndexEntry {
  key: string;
  eco: string;
  name: string;
  ply: number;
}

function normaliseMoves(pgn: string): string {
  // Strip move numbers and ellipsis: "1. e4 e5 2. Nf3" → "e4 e5 Nf3"
  return pgn
    .replace(/\d+\.{1,3}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX: IndexEntry[] = ECO_DB.map(([pgn, eco, name]) => {
  const key = normaliseMoves(pgn);
  return { key, eco, name, ply: key.split(' ').length };
});

// Sort longest-first so the first match we hit is the most specific.
INDEX.sort((a, b) => b.ply - a.ply);

/**
 * Look up the ECO code for a game given its SAN move history from
 * the starting position. Returns the most specific (longest) match,
 * or null if no opening matches.
 *
 * @param sanMoves Array of SAN strings starting from move 1,
 *   e.g. `['e4', 'e5', 'Nf3', 'Nc6']`.
 */
export function lookupEco(sanMoves: string[]): EcoEntry | null {
  if (sanMoves.length === 0) return null;

  for (const entry of INDEX) {
    if (entry.ply > sanMoves.length) continue;
    const prefix = sanMoves.slice(0, entry.ply).join(' ');
    if (prefix === entry.key) {
      return { eco: entry.eco, name: entry.name };
    }
  }
  return null;
}

/**
 * Maximum ply at which a move can still be classified as "book".
 * Beyond this depth we always run the engine classification, even
 * if the line is still in the ECO database.
 */
const BOOK_MAX_PLY = 16;

/**
 * Should the move at `ply` be classified as "book"? True when there
 * exists a known ECO line that extends to at least `ply` depth and
 * whose first `ply` moves match the game. This ensures that once the
 * player deviates from all known lines, moves stop being tagged book
 * — even though a shorter prefix still matches an ECO entry.
 */
export function isBookMove(sanMoves: string[], ply: number): boolean {
  if (ply > BOOK_MAX_PLY || ply === 0) return false;
  const prefix = sanMoves.slice(0, ply).join(' ');
  for (const entry of INDEX) {
    if (entry.ply < ply) continue; // entry too short to cover this ply
    // Compare the game's first `ply` moves against this entry's first `ply` moves.
    const entryPrefix = entry.key.split(' ').slice(0, ply).join(' ');
    if (prefix === entryPrefix) return true;
  }
  return false;
}

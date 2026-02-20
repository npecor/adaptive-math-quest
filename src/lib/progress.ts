import type { LeaderboardMode, LeaderboardRow } from './leaderboard-api';
import type { MuseumEntry, TotalsState } from './types';

export const getExtensionsSolved = (museum: MuseumEntry[]) =>
  museum.reduce((sum, entry) => sum + (entry.solved ? entry.extensionsCompleted : 0), 0);

export const upsertSolvedPuzzleIds = (ids: string[], puzzleId: string, solved: boolean): string[] => {
  if (!solved) return ids;
  if (ids.includes(puzzleId)) return ids;
  return [...ids, puzzleId];
};

export const recalcTotals = (
  totals: TotalsState,
  solvedPuzzleIds: string[],
  museum: MuseumEntry[]
): TotalsState => ({
  ...totals,
  trophiesEarned: solvedPuzzleIds.length,
  extensionsSolved: getExtensionsSolved(museum)
});

export const applyStarAward = (totals: TotalsState, starsAwarded: number): TotalsState => ({
  ...totals,
  allTimeStars: totals.allTimeStars + starsAwarded
});

export const completeRunTotals = (
  totals: TotalsState,
  starsThisRound: number,
  bonusStars: number
): TotalsState => {
  const allTimeStars = totals.allTimeStars + Math.max(0, bonusStars);
  const finalRunStars = starsThisRound + Math.max(0, bonusStars);
  return {
    ...totals,
    allTimeStars,
    bestRunStars: Math.max(totals.bestRunStars, finalRunStars),
    runsPlayed: totals.runsPlayed + 1
  };
};

export const getLeaderboardPrimaryValue = (row: LeaderboardRow, mode: LeaderboardMode) => {
  if (mode === 'best_run') return row.bestRunStars;
  if (mode === 'trophies') return row.trophiesEarned;
  return row.allTimeStars;
};

export const sortLeaderboardRows = (rows: LeaderboardRow[], mode: LeaderboardMode) =>
  [...rows].sort((a, b) => {
    if (mode === 'best_run') {
      if (b.bestRunStars !== a.bestRunStars) return b.bestRunStars - a.bestRunStars;
      if (b.allTimeStars !== a.allTimeStars) return b.allTimeStars - a.allTimeStars;
      return a.updatedAt.localeCompare(b.updatedAt);
    }
    if (mode === 'trophies') {
      if (b.trophiesEarned !== a.trophiesEarned) return b.trophiesEarned - a.trophiesEarned;
      if (b.extensionsSolved !== a.extensionsSolved) return b.extensionsSolved - a.extensionsSolved;
      if (b.allTimeStars !== a.allTimeStars) return b.allTimeStars - a.allTimeStars;
      return a.updatedAt.localeCompare(b.updatedAt);
    }
    if (b.allTimeStars !== a.allTimeStars) return b.allTimeStars - a.allTimeStars;
    if (b.bestRunStars !== a.bestRunStars) return b.bestRunStars - a.bestRunStars;
    return a.updatedAt.localeCompare(b.updatedAt);
  });

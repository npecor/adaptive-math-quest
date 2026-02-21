import type { LeaderboardMode, LeaderboardRow } from './leaderboard-api';
import type { MuseumEntry, TotalsState } from './types';

export const MAX_REASONABLE_RUN_STARS = 660;

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
    bestRunStars: Math.max(totals.bestRunStars, Math.min(finalRunStars, MAX_REASONABLE_RUN_STARS)),
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

type LeaderboardUserStats = {
  userId?: string;
  username?: string;
  avatarId?: string;
  allTimeStars: number;
  bestRunStars: number;
  trophiesEarned: number;
  extensionsSolved: number;
};

const getTodayKey = (date = new Date()) => date.toISOString().slice(0, 10);

const staticRivals = (dateKey: string): LeaderboardRow[] => [
  {
    rank: 0,
    userId: 'bot-nova',
    username: 'Nova',
    avatarId: 'animal-axo-naut',
    allTimeStars: 476,
    bestRunStars: 188,
    trophiesEarned: 6,
    extensionsSolved: 5,
    updatedAt: `${dateKey}T00:00:01.000Z`,
    isBot: true
  },
  {
    rank: 0,
    userId: 'bot-cyber',
    username: 'Cyber',
    avatarId: 'astro-bot',
    allTimeStars: 412,
    bestRunStars: 172,
    trophiesEarned: 5,
    extensionsSolved: 4,
    updatedAt: `${dateKey}T00:00:02.000Z`,
    isBot: true
  },
  {
    rank: 0,
    userId: 'bot-cometx',
    username: 'Comet_X',
    avatarId: 'animal-stardust-fish',
    allTimeStars: 338,
    bestRunStars: 149,
    trophiesEarned: 3,
    extensionsSolved: 2,
    updatedAt: `${dateKey}T00:00:03.000Z`,
    isBot: true
  }
];

export const buildLeaderboardEntries = (
  mode: LeaderboardMode,
  userStats: LeaderboardUserStats,
  date = new Date()
): LeaderboardRow[] => {
  const dateKey = getTodayKey(date);
  const youRow: LeaderboardRow = {
    rank: 0,
    userId: userStats.userId ?? 'local-you',
    username: userStats.username ?? 'You',
    avatarId: userStats.avatarId ?? 'astro-bot',
    allTimeStars: userStats.allTimeStars,
    bestRunStars: userStats.bestRunStars,
    trophiesEarned: userStats.trophiesEarned,
    extensionsSolved: userStats.extensionsSolved,
    updatedAt: `${dateKey}T23:59:59.000Z`
  };

  const merged = new Map<string, LeaderboardRow>();
  merged.set(youRow.userId, youRow);
  const rivals = staticRivals(dateKey);
  for (const rival of rivals) {
    merged.set(rival.userId, rival);
  }

  return sortLeaderboardRows([...merged.values()], mode).map((row, index) => ({ ...row, rank: index + 1 }));
};

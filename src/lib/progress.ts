import type { LeaderboardMode, LeaderboardRow } from './leaderboard-api';
import type { MuseumEntry, TotalsState } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

type LeaderboardUserStats = {
  userId?: string;
  username?: string;
  avatarId?: string;
  allTimeStars: number;
  bestRunStars: number;
  trophiesEarned: number;
  extensionsSolved: number;
};

const dailySeed = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const getTodayKey = (date = new Date()) => date.toISOString().slice(0, 10);

const withMetricByMode = (
  mode: LeaderboardMode,
  user: LeaderboardRow,
  metricValue: number,
  seed: number,
  intensity: 'high' | 'mid' | 'low'
): LeaderboardRow => {
  const nudge = (base: number, maxDelta: number) => Math.max(0, base + ((seed % (maxDelta * 2 + 1)) - maxDelta));
  const offsets = intensity === 'high' ? { stars: 24, run: 4, trophies: 2 } : intensity === 'mid' ? { stars: 12, run: 2, trophies: 1 } : { stars: 8, run: 1, trophies: 1 };

  if (mode === 'all_time') {
    return {
      ...user,
      allTimeStars: metricValue,
      bestRunStars: nudge(user.bestRunStars, offsets.run),
      trophiesEarned: nudge(user.trophiesEarned, offsets.trophies),
      extensionsSolved: Math.max(0, nudge(user.extensionsSolved, offsets.trophies))
    };
  }

  if (mode === 'best_run') {
    return {
      ...user,
      allTimeStars: nudge(user.allTimeStars, offsets.stars),
      bestRunStars: metricValue,
      trophiesEarned: nudge(user.trophiesEarned, offsets.trophies),
      extensionsSolved: Math.max(0, nudge(user.extensionsSolved, offsets.trophies))
    };
  }

  return {
    ...user,
    allTimeStars: nudge(user.allTimeStars, offsets.stars),
    bestRunStars: nudge(user.bestRunStars, offsets.run),
    trophiesEarned: metricValue,
    extensionsSolved: Math.max(0, metricValue - (seed % 2))
  };
};

const buildRivals = (mode: LeaderboardMode, user: LeaderboardRow, dateKey: string): LeaderboardRow[] => {
  const activeMetric = getLeaderboardPrimaryValue(user, mode);
  const metricValues = (() => {
    if (mode === 'all_time') {
      if (activeMetric >= 20) {
        return {
          nova: activeMetric + clamp(Math.round(activeMetric * 0.06), 6, 24),
          cyber: Math.max(0, activeMetric - clamp(Math.round(activeMetric * 0.05), 5, 20)),
          comet: Math.max(0, activeMetric - clamp(Math.round(activeMetric * 0.18), 18, 80))
        };
      }
      return { nova: activeMetric + 7, cyber: Math.max(0, activeMetric - 4), comet: Math.max(0, activeMetric - 10) };
    }

    if (mode === 'best_run') {
      if (activeMetric >= 10) {
        return { nova: activeMetric + 3, cyber: Math.max(0, activeMetric - 2), comet: Math.max(0, activeMetric - 6) };
      }
      return { nova: activeMetric + 2, cyber: Math.max(0, activeMetric - 1), comet: Math.max(0, activeMetric - 3) };
    }

    if (activeMetric >= 3) {
      return { nova: activeMetric + 1, cyber: Math.max(0, activeMetric - 1), comet: Math.max(0, activeMetric - 2) };
    }
    return { nova: activeMetric + 1, cyber: activeMetric, comet: Math.max(0, activeMetric - 1) };
  })();

  const baseBotRows: LeaderboardRow[] = [
    {
      rank: 0,
      userId: 'bot-nova',
      username: 'Nova',
      avatarId: 'animal-axo-naut',
      allTimeStars: user.allTimeStars,
      bestRunStars: user.bestRunStars,
      trophiesEarned: user.trophiesEarned,
      extensionsSolved: user.extensionsSolved,
      updatedAt: `${dateKey}T00:00:01.000Z`,
      isBot: true
    },
    {
      rank: 0,
      userId: 'bot-cyber',
      username: 'Cyber',
      avatarId: 'astro-bot',
      allTimeStars: user.allTimeStars,
      bestRunStars: user.bestRunStars,
      trophiesEarned: user.trophiesEarned,
      extensionsSolved: user.extensionsSolved,
      updatedAt: `${dateKey}T00:00:02.000Z`,
      isBot: true
    },
    {
      rank: 0,
      userId: 'bot-cometx',
      username: 'Comet_X',
      avatarId: 'animal-stardust-fish',
      allTimeStars: user.allTimeStars,
      bestRunStars: user.bestRunStars,
      trophiesEarned: user.trophiesEarned,
      extensionsSolved: user.extensionsSolved,
      updatedAt: `${dateKey}T00:00:03.000Z`,
      isBot: true
    }
  ];

  return baseBotRows.map((bot) => {
    const seed = dailySeed(`${user.userId}|${dateKey}|${mode}|${bot.userId}`);
    if (bot.userId === 'bot-nova') return withMetricByMode(mode, bot, metricValues.nova, seed, 'high');
    if (bot.userId === 'bot-cyber') return withMetricByMode(mode, bot, metricValues.cyber, seed, 'mid');
    return withMetricByMode(mode, bot, metricValues.comet, seed, 'low');
  });
};

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
  const rivals = buildRivals(mode, youRow, dateKey);
  for (const rival of rivals) {
    merged.set(rival.userId, rival);
  }

  return sortLeaderboardRows([...merged.values()], mode).map((row, index) => ({ ...row, rank: index + 1 }));
};

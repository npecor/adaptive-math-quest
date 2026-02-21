import type { AppState } from './types';
import { MAX_REASONABLE_RUN_STARS } from './progress';

const KEY = 'amq_state_v1';

export const defaultState: AppState = {
  skill: { rating: 1000, attemptsCount: 0 },
  streaks: { dailyStreak: 0, longestDailyStreak: 0, puzzleStreak: 0, longestPuzzleStreak: 0 },
  highs: { bestTotal: 0, bestSprint: 0, bestBrain: 0 },
  museum: [],
  totals: {
    allTimeStars: 0,
    bestRunStars: 0,
    runsPlayed: 0,
    trophiesEarned: 0,
    extensionsSolved: 0,
    allTimePuzzleCorrect: 0,
    allTimePuzzleTries: 0
  },
  solvedPuzzleIds: []
};

const unique = (values: string[]) => [...new Set(values)];
const toSafeInt = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
};

const normalizeState = (raw: unknown): AppState => {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppState>;
  const museum = (Array.isArray(parsed.museum) ? parsed.museum : defaultState.museum).map((entry) => ({
    ...entry,
    attempts: Math.max(1, toSafeInt((entry as { attempts?: unknown })?.attempts, 1))
  }));
  const solvedFromMuseum = museum.filter((entry) => entry?.solved).map((entry) => entry.puzzleId);
  const solvedPuzzleIds = unique([...(Array.isArray(parsed.solvedPuzzleIds) ? parsed.solvedPuzzleIds : []), ...solvedFromMuseum]);
  const extensionsSolved = museum.reduce((sum, entry) => sum + (entry?.solved ? entry.extensionsCompleted ?? 0 : 0), 0);
  const parsedTotals: Partial<AppState['totals']> = parsed.totals ?? {};
  const allTimePuzzleCorrect =
    typeof parsedTotals.allTimePuzzleCorrect === 'number'
      ? parsedTotals.allTimePuzzleCorrect
      : solvedPuzzleIds.length;
  const allTimePuzzleTries = Math.max(
    typeof parsedTotals.allTimePuzzleTries === 'number'
      ? parsedTotals.allTimePuzzleTries
      : Math.max(defaultState.totals.allTimePuzzleTries, allTimePuzzleCorrect),
    allTimePuzzleCorrect
  );

  const resolvedAllTimeStars = toSafeInt(
    parsed.totals?.allTimeStars ??
      (typeof parsed.highs?.bestTotal === 'number' ? parsed.highs.bestTotal : defaultState.totals.allTimeStars),
    defaultState.totals.allTimeStars
  );
  const candidateBestRunStars = toSafeInt(
    parsed.totals?.bestRunStars ??
      (typeof parsed.highs?.bestTotal === 'number' ? parsed.highs.bestTotal : defaultState.totals.bestRunStars),
    defaultState.totals.bestRunStars
  );
  const totals = {
    ...defaultState.totals,
    ...parsedTotals,
    allTimeStars: resolvedAllTimeStars,
    // Best run cannot exceed all-time stars; this also corrects legacy inflated values.
    bestRunStars: Math.min(candidateBestRunStars, resolvedAllTimeStars, MAX_REASONABLE_RUN_STARS),
    runsPlayed: toSafeInt(parsedTotals.runsPlayed, defaultState.totals.runsPlayed),
    trophiesEarned: solvedPuzzleIds.length,
    extensionsSolved,
    allTimePuzzleCorrect: toSafeInt(allTimePuzzleCorrect, defaultState.totals.allTimePuzzleCorrect),
    allTimePuzzleTries: toSafeInt(allTimePuzzleTries, defaultState.totals.allTimePuzzleTries)
  };

  return {
    ...defaultState,
    ...parsed,
    skill: { ...defaultState.skill, ...(parsed.skill ?? {}) },
    streaks: { ...defaultState.streaks, ...(parsed.streaks ?? {}) },
    highs: { ...defaultState.highs, ...(parsed.highs ?? {}) },
    museum,
    totals,
    solvedPuzzleIds
  };
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState;
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

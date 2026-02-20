import type { AppState } from './types';

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

const normalizeState = (raw: unknown): AppState => {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppState>;
  const museum = Array.isArray(parsed.museum) ? parsed.museum : defaultState.museum;
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

  const totals = {
    ...defaultState.totals,
    ...parsedTotals,
    allTimeStars:
      parsed.totals?.allTimeStars ??
      (typeof parsed.highs?.bestTotal === 'number' ? parsed.highs.bestTotal : defaultState.totals.allTimeStars),
    bestRunStars:
      parsed.totals?.bestRunStars ??
      (typeof parsed.highs?.bestTotal === 'number' ? parsed.highs.bestTotal : defaultState.totals.bestRunStars),
    trophiesEarned: solvedPuzzleIds.length,
    extensionsSolved,
    allTimePuzzleCorrect,
    allTimePuzzleTries
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

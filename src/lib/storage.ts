import type { AppState } from './types';

const KEY = 'amq_state_v1';

export const defaultState: AppState = {
  skill: { rating: 1000, attemptsCount: 0 },
  streaks: { dailyStreak: 0, longestDailyStreak: 0, puzzleStreak: 0, longestPuzzleStreak: 0 },
  highs: { bestTotal: 0, bestSprint: 0, bestBrain: 0 },
  museum: []
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState;
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return defaultState;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

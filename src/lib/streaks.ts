import type { StreakState } from './types';

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export function updateDailyStreak(streaks: StreakState, now = new Date()): StreakState {
  const today = dayKey(now);
  if (!streaks.lastPlayedDay) {
    return { ...streaks, dailyStreak: 1, longestDailyStreak: Math.max(streaks.longestDailyStreak, 1), lastPlayedDay: today };
  }
  if (streaks.lastPlayedDay === today) return streaks;

  const prev = new Date(streaks.lastPlayedDay);
  const diffDays = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate())) / (1000 * 60 * 60 * 24));
  const nextStreak = diffDays === 1 ? streaks.dailyStreak + 1 : 1;
  return {
    ...streaks,
    dailyStreak: nextStreak,
    longestDailyStreak: Math.max(streaks.longestDailyStreak, nextStreak),
    lastPlayedDay: today
  };
}

export function updatePuzzleStreak(streaks: StreakState, solvedWithoutReveal: boolean): StreakState {
  const next = solvedWithoutReveal ? streaks.puzzleStreak + 1 : 0;
  return {
    ...streaks,
    puzzleStreak: next,
    longestPuzzleStreak: Math.max(streaks.longestPuzzleStreak, next)
  };
}

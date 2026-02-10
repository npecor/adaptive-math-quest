import { describe, expect, it } from 'vitest';
import { updateDailyStreak, updatePuzzleStreak } from '../lib/streaks';
import type { StreakState } from '../lib/types';

const base: StreakState = { dailyStreak: 0, longestDailyStreak: 0, puzzleStreak: 0, longestPuzzleStreak: 0 };

describe('streak logic', () => {
  it('increments daily streak on consecutive day', () => {
    const d1 = updateDailyStreak(base, new Date('2026-01-01T12:00:00Z'));
    const d2 = updateDailyStreak(d1, new Date('2026-01-02T12:00:00Z'));
    expect(d2.dailyStreak).toBe(2);
  });

  it('resets daily streak after gap', () => {
    const d1 = updateDailyStreak(base, new Date('2026-01-01T12:00:00Z'));
    const d2 = updateDailyStreak(d1, new Date('2026-01-03T12:00:00Z'));
    expect(d2.dailyStreak).toBe(1);
  });

  it('resets puzzle streak when reveal used', () => {
    const p1 = updatePuzzleStreak(base, true);
    const p2 = updatePuzzleStreak(p1, false);
    expect(p1.puzzleStreak).toBe(1);
    expect(p2.puzzleStreak).toBe(0);
  });
});

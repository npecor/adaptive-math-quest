import { describe, expect, it } from 'vitest';
import type { LeaderboardRow } from '../lib/leaderboard-api';
import type { MuseumEntry, TotalsState } from '../lib/types';
import { applyStarAward, completeRunTotals, recalcTotals, sortLeaderboardRows, upsertSolvedPuzzleIds } from '../lib/progress';

const baseTotals = (): TotalsState => ({
  allTimeStars: 0,
  bestRunStars: 0,
  runsPlayed: 0,
  trophiesEarned: 0,
  extensionsSolved: 0,
  allTimePuzzleCorrect: 0,
  allTimePuzzleTries: 0
});

describe('progress logic', () => {
  it('resets round stars while all-time stars keep accumulating', () => {
    let totals = baseTotals();

    let starsThisRound = 0;
    starsThisRound += 10;
    totals = applyStarAward(totals, 10);
    starsThisRound += 7;
    totals = applyStarAward(totals, 7);
    totals = completeRunTotals(totals, starsThisRound, 0);

    expect(starsThisRound).toBe(17);
    expect(totals.allTimeStars).toBe(17);
    expect(totals.bestRunStars).toBe(17);
    expect(totals.runsPlayed).toBe(1);

    starsThisRound = 0; // New round starts
    starsThisRound += 5;
    totals = applyStarAward(totals, 5);
    totals = completeRunTotals(totals, starsThisRound, 0);

    expect(starsThisRound).toBe(5);
    expect(totals.allTimeStars).toBe(22);
    expect(totals.bestRunStars).toBe(17);
    expect(totals.runsPlayed).toBe(2);
  });

  it('does not increase trophies when the same puzzle is solved twice', () => {
    let totals = baseTotals();
    let solvedPuzzleIds: string[] = [];
    const museum: MuseumEntry[] = [];

    solvedPuzzleIds = upsertSolvedPuzzleIds(solvedPuzzleIds, 'logic-two-airlocks', true);
    museum.push({
      puzzleId: 'logic-two-airlocks',
      title: 'Two Airlocks',
      solved: true,
      extensionsCompleted: 1,
      methodsFound: ['core-solved']
    });
    totals = recalcTotals(totals, solvedPuzzleIds, museum);
    expect(totals.trophiesEarned).toBe(1);

    solvedPuzzleIds = upsertSolvedPuzzleIds(solvedPuzzleIds, 'logic-two-airlocks', true);
    museum[0] = { ...museum[0], solved: true, extensionsCompleted: 2 };
    totals = recalcTotals(totals, solvedPuzzleIds, museum);

    expect(totals.trophiesEarned).toBe(1);
    expect(totals.extensionsSolved).toBe(2);
  });

  it('sorts leaderboard differently by selected mode', () => {
    const rows: LeaderboardRow[] = [
      {
        rank: 0,
        userId: 'a',
        username: 'Alpha',
        avatarId: 'astro-bot',
        allTimeStars: 800,
        bestRunStars: 90,
        trophiesEarned: 5,
        extensionsSolved: 1,
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        rank: 0,
        userId: 'b',
        username: 'Beta',
        avatarId: 'astro-bot',
        allTimeStars: 700,
        bestRunStars: 120,
        trophiesEarned: 4,
        extensionsSolved: 3,
        updatedAt: '2026-01-02T00:00:00.000Z'
      },
      {
        rank: 0,
        userId: 'c',
        username: 'Gamma',
        avatarId: 'astro-bot',
        allTimeStars: 600,
        bestRunStars: 80,
        trophiesEarned: 5,
        extensionsSolved: 5,
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ];

    expect(sortLeaderboardRows(rows, 'all_time')[0].userId).toBe('a');
    expect(sortLeaderboardRows(rows, 'best_run')[0].userId).toBe('b');
    expect(sortLeaderboardRows(rows, 'trophies')[0].userId).toBe('c');
  });
});

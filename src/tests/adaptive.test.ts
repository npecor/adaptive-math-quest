import { describe, expect, it } from 'vitest';
import { expectedProbability, selectNextFlowItem, updateRating } from '../lib/adaptive';
import type { FlowItem } from '../lib/types';

describe('rating update', () => {
  it('increases after correct and decreases after incorrect', () => {
    const up = updateRating(1000, 1000, true, 0);
    const down = updateRating(1000, 1000, false, 0);
    expect(up).toBeGreaterThan(1000);
    expect(down).toBeLessThan(1000);
  });

  it('uses elo expected probability', () => {
    const p = expectedProbability(1200, 1000);
    expect(p).toBeGreaterThan(0.7);
  });
});

const mk = (id: string, difficulty: number): FlowItem => ({
  id,
  type: 'flow',
  difficulty,
  tags: ['x'],
  format: 'numeric_input',
  prompt: 'p',
  answer: '1',
  hints: ['h1', 'h2'],
  solution_steps: ['s1', 's2']
});

describe('item selection distribution', () => {
  it('mostly targets near rating across many draws', () => {
    const items = Array.from({ length: 50 }, (_, i) => mk(String(i), 760 + i * 20));
    const counts = { near: 0, stretch: 0, easy: 0 };
    for (let i = 0; i < 800; i++) {
      const picked = selectNextFlowItem(items, 1100, new Set());
      if (picked.difficulty >= 1050 && picked.difficulty <= 1150) counts.near++;
      else if (picked.difficulty > 1150) counts.stretch++;
      else counts.easy++;
    }
    expect(counts.near).toBeGreaterThan(counts.stretch);
    expect(counts.near).toBeGreaterThan(counts.easy);
  });
});

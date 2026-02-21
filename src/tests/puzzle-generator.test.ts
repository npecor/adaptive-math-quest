import { describe, expect, it } from 'vitest';
import { generateAdaptivePuzzleItem } from '../lib/puzzle-generator';

describe('puzzle generator', () => {
  it('produces both Yes and No shape-swap outcomes over a sample run', () => {
    const used = new Set<string>();
    let sawYes = false;
    let sawNo = false;

    for (let i = 0; i < 600; i += 1) {
      const item = generateAdaptivePuzzleItem(1100, used);
      used.add(item.id);
      if (!item.id.startsWith('spatial_area-')) continue;
      if (item.core_answer === 'Yes') sawYes = true;
      if (item.core_answer === 'No') sawNo = true;
      if (sawYes && sawNo) break;
    }

    expect(sawYes).toBe(true);
    expect(sawNo).toBe(true);
  });

  it('samples all major puzzle families over a run', () => {
    const used = new Set<string>();
    const seenTypes = new Set<string>();

    for (let i = 0; i < 1200; i += 1) {
      const item = generateAdaptivePuzzleItem(1200, used);
      used.add(item.id);
      if (item.puzzleType) seenTypes.add(item.puzzleType);
      if (seenTypes.size >= 5) break;
    }

    expect(seenTypes.has('word')).toBe(true);
    expect(seenTypes.has('logic')).toBe(true);
    expect(seenTypes.has('pattern')).toBe(true);
    expect(seenTypes.has('spatial')).toBe(true);
    expect(seenTypes.has('constraint')).toBe(true);
  });

  it('avoids decimal tokens in puzzle prompts and core answers', () => {
    const used = new Set<string>();
    const decimalPattern = /\d+\.\d+/;
    const fastMathPattern = [
      /which is (bigger|greater)/i,
      /\bx\s*[+\-*/÷×]\s*\d+\s*=\s*-?\d+/i,
      /^\s*\d+\s*[+\-×x÷/*]\s*\d+\s*=\s*\?\s*$/i
    ];
    const bannedAlgebra = /\bn\b|n\^2|n²|n\(\s*n\s*[\+\-]\s*1\s*\)|n\(\s*n\s*-\s*1\s*\)|n\(\s*n\s*\+\s*1\s*\)/i;

    for (let i = 0; i < 500; i += 1) {
      const item = generateAdaptivePuzzleItem(1200, used);
      used.add(item.id);
      expect(item.core_prompt).not.toMatch(decimalPattern);
      expect(item.core_answer).not.toMatch(decimalPattern);
      expect(item.core_prompt).not.toMatch(bannedAlgebra);
      expect(item.hint_ladder).toHaveLength(3);
      expect(item.solution_steps).toHaveLength(3);
      expect(fastMathPattern.some((pattern) => pattern.test(item.core_prompt))).toBe(false);
    }
  });
});

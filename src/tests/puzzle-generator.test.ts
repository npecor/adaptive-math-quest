import { describe, expect, it } from 'vitest';
import { generateAdaptivePuzzleItem } from '../lib/puzzle-generator';

describe('puzzle generator', () => {
  it('produces both Yes and No area_yn outcomes over a sample run', () => {
    const used = new Set<string>();
    let sawYes = false;
    let sawNo = false;

    for (let i = 0; i < 400; i += 1) {
      const item = generateAdaptivePuzzleItem(1100, used);
      used.add(item.id);
      if (!item.id.startsWith('area_yn-')) continue;
      if (item.core_answer === 'Yes') sawYes = true;
      if (item.core_answer === 'No') sawNo = true;
      if (sawYes && sawNo) break;
    }

    expect(sawYes).toBe(true);
    expect(sawNo).toBe(true);
  });

  it('includes stars and logic puzzle families in sampled output', () => {
    const used = new Set<string>();
    let sawStars = false;
    let sawLogic = false;

    for (let i = 0; i < 300; i += 1) {
      const item = generateAdaptivePuzzleItem(1200, used);
      used.add(item.id);
      if (item.id.startsWith('stars-')) sawStars = true;
      if (item.id.startsWith('logic-')) sawLogic = true;
      if (sawStars && sawLogic) break;
    }

    expect(sawStars).toBe(true);
    expect(sawLogic).toBe(true);
  });
});

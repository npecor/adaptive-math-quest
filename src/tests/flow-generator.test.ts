import { describe, expect, it } from 'vitest';
import { generateAdaptiveFlowItem, makeUniqueChoices } from '../lib/flow-generator';

describe('flow multiple-choice generation', () => {
  it('makeUniqueChoices returns unique options and includes correct once', () => {
    const choices = makeUniqueChoices(84, [84, 84, 86, 80, 80, 86, 168, 42], 4);
    expect(choices).toHaveLength(4);
    expect(new Set(choices).size).toBe(4);
    expect(choices.filter((choice) => choice === 84)).toHaveLength(1);
  });

  it('lcm template emits unique choices with exactly one correct answer', () => {
    let found = 0;

    for (let i = 0; i < 6000; i += 1) {
      const item = generateAdaptiveFlowItem(1425, new Set<string>());
      if (item.template !== 'lcm') continue;
      found += 1;

      const choices = item.choices ?? [];
      expect(choices.length).toBeGreaterThan(0);
      expect(new Set(choices).size).toBe(choices.length);
      expect(choices.filter((choice) => choice === item.answer)).toHaveLength(1);

      if (found >= 40) break;
    }

    expect(found).toBeGreaterThan(0);
  });

  it('fraction_compare template keeps choices unique and includes correct answer', () => {
    let found = 0;

    for (let i = 0; i < 2000; i += 1) {
      const item = generateAdaptiveFlowItem(975, new Set<string>());
      if (item.template !== 'fraction_compare') continue;
      found += 1;

      const choices = item.choices ?? [];
      expect(choices.length).toBeGreaterThan(0);
      expect(new Set(choices).size).toBe(choices.length);
      expect(choices).toContain(item.answer);
    }

    expect(found).toBeGreaterThan(0);
  });
});

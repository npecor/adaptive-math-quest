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

describe('flow coaching hints', () => {
  it('non-times-table multiplication includes a concrete break-apart rewrite', () => {
    let found = 0;
    for (let i = 0; i < 6000; i += 1) {
      const item = generateAdaptiveFlowItem(1125, new Set<string>());
      if (item.template !== 'mult_div' || item.shapeSignature !== 'mul_basic') continue;
      const match = item.prompt.match(/^\s*(\d+)\s*[×x]\s*(\d+)\s*=\s*\?\s*$/);
      if (!match) continue;
      const left = Number(match[1]);
      const right = Number(match[2]);
      if (left <= 12 && right <= 12) continue;
      found += 1;
      const hintBlob = item.hints.join(' ');
      expect(hintBlob).toMatch(/\bBreak\b/i);
      expect(hintBlob).toMatch(/=\s*.+\+\s*.+/);
      break;
    }

    expect(found).toBeGreaterThan(0);
  });

  it('rectangle area hints include a concrete rewrite and computed parts', () => {
    let found = 0;
    for (const rating of [1125, 1275]) {
      for (let i = 0; i < 7000; i += 1) {
        const item = generateAdaptiveFlowItem(rating, new Set<string>());
        if (item.template !== 'geometry' || item.shapeSignature !== 'geom_rect_area') continue;
        found += 1;
        expect(item.hints[0]).toMatch(/Area means|length × width/i);
        expect(item.hints[1]).toMatch(/Rewrite:/i);
        expect(item.hints[1]).toMatch(/=\s*.+\+\s*.+/);
        expect(item.hints[2]).toMatch(/Compute:/i);
        break;
      }
      if (found > 0) break;
    }

    expect(found).toBeGreaterThan(0);
  });

  it('order-of-ops hints tell kids to do multiplication first and plug back in', () => {
    let found = 0;
    for (let i = 0; i < 6000; i += 1) {
      const item = generateAdaptiveFlowItem(1125, new Set<string>());
      if (item.template !== 'order_ops' || item.shapeSignature !== 'expr_order_ops') continue;
      found += 1;
      expect(item.hints[0]).toMatch(/multiplication first/i);
      expect(item.hints[2]).toMatch(/Plug back in/i);
      expect(item.hints[2]).toMatch(/=/);
      break;
    }

    expect(found).toBeGreaterThan(0);
  });
});

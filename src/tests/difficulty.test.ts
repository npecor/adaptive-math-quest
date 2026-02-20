import { describe, expect, it } from 'vitest';
import { annotateFlowItem } from '../lib/difficulty';
import type { FlowItem } from '../lib/types';

const mkFlow = (prompt: string, template: FlowItem['template'], shapeSignature: string): FlowItem => ({
  id: 'test-item',
  type: 'flow',
  difficulty: 1000,
  template,
  shapeSignature,
  tags: [],
  format: 'numeric_input',
  prompt,
  answer: '0',
  hints: ['h1', 'h2', 'h3'],
  solution_steps: ['s1', 's2']
});

describe('annotateFlowItem', () => {
  it('downgrades easy x10 multiplication patterns', () => {
    const item = mkFlow('10 × 7 = ?', 'mult_div', 'mul_basic');
    const annotated = annotateFlowItem(item);
    expect(annotated.tier === 'Easy' || annotated.tier === 'Medium').toBe(true);
    expect(annotated.tags).toContain('pattern:×10');
  });

  it('marks borrow subtraction patterns', () => {
    const item = mkFlow('143 - 78 = ?', 'add_sub', 'addsub_sub_pos');
    const annotated = annotateFlowItem(item);
    expect(annotated.tags).toContain('requires:borrow');
    expect(annotated.difficulty).toBeGreaterThanOrEqual(900);
  });

  it('keeps two-step parentheses equations at high difficulty tiers', () => {
    const item = mkFlow('9(x - 6) = 108', 'equation_2', 'eq_a_paren_x_minus_c');
    const annotated = annotateFlowItem(item);
    expect(annotated.tier === 'Hard' || annotated.tier === 'Expert' || annotated.tier === 'Master').toBe(true);
    expect(annotated.tags).toContain('form:eq_parens');
  });
});

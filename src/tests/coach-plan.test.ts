import { describe, expect, it } from 'vitest';
import { buildFlowCoachPlan } from '../lib/coach-plan';
import type { FlowItem } from '../lib/types';

const makeFlowItem = (prompt: string, answer: string): FlowItem => ({
  id: 'test-item',
  type: 'flow',
  difficulty: 800,
  tier: 'Easy',
  template: 'add_sub',
  shapeSignature: 'addsub_sub_pos',
  tags: ['add_sub'],
  format: 'numeric_input',
  prompt,
  answer,
  hints: [],
  solution_steps: []
});

describe('coach plan add/sub quality', () => {
  it('uses direct subtract-10 coaching for 18 - 10 and avoids pointless split wording', () => {
    const item = makeFlowItem('18 - 10 = ?', '8');
    const coach = buildFlowCoachPlan(item);
    const combined = `${coach.quickHint} ${coach.steps.join(' ')}`;

    expect(combined).toMatch(/subtract(?:ing)?\s+10/i);
    expect(combined).toMatch(/18\s*(?:→|->)\s*8|18\s*-\s*10\s*=\s*8/i);
    expect(combined).not.toMatch(/10\s+and\s+0/i);
    expect(coach.steps.length).toBeLessThanOrEqual(2);
  });
});


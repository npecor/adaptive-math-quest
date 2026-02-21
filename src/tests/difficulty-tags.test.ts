import { describe, expect, it } from 'vitest';
import { analyzeFlowItem, difficultyLabelFromScore } from '../lib/difficulty-tags';
import { generateAdaptiveFlowItem } from '../lib/flow-generator';
import { generateAdaptivePuzzleItem } from '../lib/puzzle-generator';
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

describe('difficulty tags', () => {
  it('labels single-step 3-12 times-table multiplication as Easy', () => {
    const item = mkFlow('7 × 8 = ?', 'mult_div', 'mul_basic');
    const analyzed = analyzeFlowItem(item);
    expect(analyzed.tags).toContain('pattern:times-table');
    expect(analyzed.difficultyLabel).toBe('Easy');
  });

  it('labels order-of-ops expressions as at least Medium', () => {
    const item = mkFlow('8 + 3 × 4 = ?', 'order_ops', 'expr_order_ops');
    const analyzed = analyzeFlowItem(item);
    const labels = ['Easy', 'Medium', 'Hard', 'Expert', 'Master'] as const;
    expect(labels.indexOf(analyzed.difficultyLabel)).toBeGreaterThanOrEqual(labels.indexOf('Medium'));
  });

  it('never yields negative subtraction for Easy-labeled subtraction items', () => {
    const used = new Set<string>();
    let prevDifficulty: number | undefined;
    let recentTemplates: string[] = [];
    let recentShapes: string[] = [];
    let recentPatternTags: string[] = [];

    for (let i = 0; i < 700; i += 1) {
      const item = generateAdaptiveFlowItem(850, used, prevDifficulty, recentTemplates, recentShapes, recentPatternTags, 0);
      used.add(item.id);
      prevDifficulty = item.difficulty;
      recentTemplates = [...recentTemplates, item.template].slice(-6);
      recentShapes = [...recentShapes, item.shapeSignature].slice(-6);
      recentPatternTags = [...recentPatternTags, ...item.tags.filter((tag) => tag.startsWith('pattern:'))].slice(-6);

      const sub = item.prompt.match(/^(\d+)\s*-\s*(\d+)\s*=\s*\?$/);
      if (!sub) continue;
      const label = item.tier ?? difficultyLabelFromScore(item.difficulty);
      if (label === 'Easy') {
        expect(Number(item.answer)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('does not label non-negative one-step equations as Hard+', () => {
    let checked = 0;
    for (let i = 0; i < 6000 && checked < 200; i += 1) {
      const item = generateAdaptiveFlowItem(1125, new Set<string>());
      if (item.template !== 'equation_1' || !item.tags.includes('eq:one-step') || item.tags.includes('sub:negative')) continue;
      checked += 1;
      const label = item.tier ?? difficultyLabelFromScore(item.difficulty);
      expect(['Hard', 'Expert', 'Master']).not.toContain(label);
    }
    expect(checked).toBeGreaterThanOrEqual(40);
  });
});

describe('puzzle prompt safety', () => {
  it('shape swap prompts never include decimals', () => {
    const used = new Set<string>();
    const decimalPattern = /\d+\.\d+/;
    for (let i = 0; i < 900; i += 1) {
      const puzzle = generateAdaptivePuzzleItem(1200, used);
      used.add(puzzle.id);
      if (!puzzle.id.startsWith('spatial_area-')) continue;
      expect(puzzle.core_prompt).not.toMatch(decimalPattern);
      expect(puzzle.solution_steps.join(' ')).not.toMatch(decimalPattern);
    }
  });

  it('puzzle prompts do not include algebraic n-notation', () => {
    const used = new Set<string>();
    const forbidden = [/n²/i, /n\^2/i, /n\s*\(n/i, /\bn\s*[-+*/]/i, /\bn\b/i];
    for (let i = 0; i < 900; i += 1) {
      const puzzle = generateAdaptivePuzzleItem(1200, used);
      used.add(puzzle.id);
      for (const pattern of forbidden) {
        expect(puzzle.core_prompt).not.toMatch(pattern);
      }
    }
  });
});

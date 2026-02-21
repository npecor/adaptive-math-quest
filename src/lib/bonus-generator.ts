import { analyzeFlowItem, difficultyLabelFromScore, type DifficultyLabel } from './difficulty-tags';
import { generateAdaptiveFlowItem } from './flow-generator';
import { generateAdaptivePuzzleItem } from './puzzle-generator';
import type { FlowItem, PuzzleItem } from './types';

export type BonusGameMode = 'galaxy_mix' | 'rocket_rush' | 'puzzle_orbit';
export type BonusLastSegment = 'flow' | 'puzzle';

export type BonusChallenge = {
  id: string;
  title: string;
  prompt: string;
  choices: string[];
  answer: string;
  hint: string;
  flavor: 'fraction' | 'fast_math' | 'puzzle';
  difficulty: number;
  label: DifficultyLabel;
  templateKey: string;
  shapeSignature: string;
  runMedianDifficulty: number;
  bonusTargetDifficulty: number;
};

const HARD_LABELS = new Set<DifficultyLabel>(['Hard', 'Expert', 'Master']);
const FRACTION_DENOMINATORS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(items: T[]): T => items[randomInt(0, items.length - 1)];
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const lcm = (a: number, b: number) => Math.abs(a * b) / Math.max(1, gcd(a, b));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const median = (values: number[]) => {
  if (values.length === 0) return 950;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const fractionValue = (n: number, d: number) => n / d;
const formatFraction = (n: number, d: number) => `${n}/${d}`;

const cleanPuzzleTitle = (title: string) => title.replace(/\s+\(Bonus\)$/i, '').trim();

const toExplicitChoices = (puzzle: PuzzleItem) => {
  if (puzzle.choices?.length) return puzzle.choices;
  const answer = puzzle.core_answer.trim().toLowerCase();
  if (answer === 'yes' || answer === 'no') return ['Yes', 'No'];
  if (['always', 'sometimes', 'never'].includes(answer)) return ['Always', 'Sometimes', 'Never'];
  return [];
};

const normalizeFlowItem = (item: FlowItem): FlowItem => {
  const analyzed = analyzeFlowItem(item);
  return {
    ...item,
    tags: [...new Set([...(item.tags ?? []), ...analyzed.tags])],
    difficulty: analyzed.difficultyScore,
    tier: analyzed.difficultyLabel,
    difficultyBreakdown: analyzed.breakdown
  };
};

const flowToBonusChallenge = (
  item: FlowItem,
  title: string,
  flavor: BonusChallenge['flavor'],
  runMedianDifficulty: number,
  bonusTargetDifficulty: number
): BonusChallenge => {
  const label = item.tier ?? difficultyLabelFromScore(item.difficulty);
  return {
    id: `bonus-${item.id}`,
    title,
    prompt: item.prompt,
    choices: item.choices ?? [],
    answer: item.answer,
    hint: item.hints[0] ?? 'Take it one step at a time.',
    flavor,
    difficulty: item.difficulty,
    label,
    templateKey: item.template,
    shapeSignature: item.shapeSignature,
    runMedianDifficulty,
    bonusTargetDifficulty
  };
};

const puzzleToBonusChallenge = (
  puzzle: PuzzleItem,
  runMedianDifficulty: number,
  bonusTargetDifficulty: number
): BonusChallenge => {
  const label = difficultyLabelFromScore(puzzle.difficulty);
  return {
    id: `bonus-${puzzle.id}`,
    title: cleanPuzzleTitle(puzzle.title) || 'Puzzle Nova',
    prompt: puzzle.core_prompt,
    choices: toExplicitChoices(puzzle),
    answer: puzzle.core_answer,
    hint: puzzle.hint_ladder[0] ?? 'Try a smaller example first.',
    flavor: 'puzzle',
    difficulty: puzzle.difficulty,
    label,
    templateKey: puzzle.id.split('-')[0] ?? 'puzzle',
    shapeSignature: puzzle.id,
    runMedianDifficulty,
    bonusTargetDifficulty
  };
};

const makeStrictFractionCandidate = (
  runMedianDifficulty: number,
  bonusTargetDifficulty: number
): BonusChallenge | null => {
  for (let tries = 0; tries < 160; tries += 1) {
    const d1 = pick(FRACTION_DENOMINATORS);
    let d2 = pick(FRACTION_DENOMINATORS);
    while (d2 === d1) d2 = pick(FRACTION_DENOMINATORS);

    const sharedLcm = lcm(d1, d2);
    if (sharedLcm <= 24) continue;
    if (d1 % d2 === 0 || d2 % d1 === 0) continue;
    if (gcd(d1, d2) > 3) continue;

    const n1 = d1 - randomInt(1, 4);
    const n2 = d2 - randomInt(1, 4);
    if (n1 <= 0 || n2 <= 0) continue;
    if (gcd(n1, d1) !== 1 || gcd(n2, d2) !== 1) continue;

    const valueGap = Math.abs(fractionValue(n1, d1) - fractionValue(n2, d2));
    if (valueGap < 0.02 || valueGap > 0.14) continue;

    const left = formatFraction(n1, d1);
    const right = formatFraction(n2, d2);
    const answer = n1 * d2 > n2 * d1 ? left : right;

    const raw: FlowItem = {
      id: `fraction_bonus-${d1}-${d2}-${n1}-${n2}`,
      type: 'flow',
      difficulty: 0,
      template: 'fraction_compare',
      shapeSignature: 'frac_compare_bonus_pair',
      tags: ['fractions', 'bonus'],
      format: 'multiple_choice',
      prompt: `Which fraction is greater? ${left} or ${right}`,
      answer,
      choices: [left, right],
      hints: [
        'Both fractions are near 1. Compare how far each is from 1.',
        `Cross-multiply: ${n1}×${d2} and ${n2}×${d1}.`,
        'The fraction with the larger cross-product is greater.'
      ],
      solution_steps: [
        `Compare ${left} and ${right} by cross-multiplying.`,
        `${n1}×${d2} = ${n1 * d2} and ${n2}×${d1} = ${n2 * d1}.`,
        `${n1 * d2 > n2 * d1 ? left : right} is greater.`
      ]
    };

    const item = normalizeFlowItem(raw);
    const label = item.tier ?? difficultyLabelFromScore(item.difficulty);
    const minimumDifficulty = Math.max(
      1050,
      Math.min(1200, bonusTargetDifficulty),
      Math.min(runMedianDifficulty + 90, 1200)
    );

    if (!HARD_LABELS.has(label)) continue;
    if (item.difficulty < minimumDifficulty) continue;

    return flowToBonusChallenge(item, 'Fraction Fox', 'fraction', runMedianDifficulty, bonusTargetDifficulty);
  }

  return null;
};

const createHardFractionFallback = (runMedianDifficulty: number, bonusTargetDifficulty: number): BonusChallenge => {
  const raw: FlowItem = {
    id: 'fraction_bonus-fallback-23-25-18-19',
    type: 'flow',
    difficulty: 0,
    template: 'fraction_compare',
    shapeSignature: 'frac_compare_bonus_pair',
    tags: ['fractions', 'bonus'],
    format: 'multiple_choice',
    prompt: 'Which fraction is greater? 23/25 or 18/19',
    answer: '23/25',
    choices: ['23/25', '18/19'],
    hints: [
      'Both fractions are very close to 1.',
      'Cross-multiply 23×19 and 18×25.',
      'The larger cross-product gives the greater fraction.'
    ],
    solution_steps: [
      'Compare 23/25 and 18/19 with cross-multiplication.',
      '23×19 = 437 and 18×25 = 450.',
      '18/19 is greater.'
    ]
  };
  const normalized = normalizeFlowItem(raw);
  const challenge = flowToBonusChallenge(normalized, 'Fraction Fox', 'fraction', runMedianDifficulty, bonusTargetDifficulty);
  challenge.answer = '18/19';
  return challenge;
};

const createFastMathBonus = (rating: number, runMedianDifficulty: number, bonusTargetDifficulty: number): BonusChallenge => {
  for (let tries = 0; tries < 180; tries += 1) {
    const candidate = generateAdaptiveFlowItem(
      clamp(Math.max(rating, bonusTargetDifficulty), 900, 1700),
      new Set<string>(),
      undefined,
      [],
      [],
      [],
      6
    );
    if (candidate.template === 'fraction_compare') continue;
    const label = candidate.tier ?? difficultyLabelFromScore(candidate.difficulty);
    const minDifficulty = Math.max(
      1080,
      Math.min(1380, bonusTargetDifficulty),
      Math.min(runMedianDifficulty + 75, 1380)
    );
    if (!HARD_LABELS.has(label)) continue;
    if (candidate.difficulty < minDifficulty) continue;
    return flowToBonusChallenge(candidate, 'Turbo Burst', 'fast_math', runMedianDifficulty, bonusTargetDifficulty);
  }

  const a = 54;
  const b = 17;
  const c = 13;
  const d = 29;
  const answer = a + b * c - d;
  const fallbackRaw: FlowItem = {
    id: `fast_bonus-fallback-${a}-${b}-${c}-${d}`,
    type: 'flow',
    difficulty: 0,
    template: 'order_ops',
    shapeSignature: 'order_ops_mix',
    tags: ['order_ops', 'bonus'],
    format: 'numeric_input',
    prompt: `${a} + ${b} × ${c} - ${d} = ?`,
    answer: String(answer),
    hints: [
      'Do multiplication before adding or subtracting.',
      `${b} × ${c} = ${b * c}.`,
      `Now solve ${a} + ${b * c} - ${d}.`
    ],
    solution_steps: [
      `Multiply first: ${b} × ${c} = ${b * c}.`,
      `Then compute ${a} + ${b * c} - ${d}.`,
      `Answer: ${answer}.`
    ]
  };
  const normalized = normalizeFlowItem(fallbackRaw);
  return flowToBonusChallenge(normalized, 'Turbo Burst', 'fast_math', runMedianDifficulty, bonusTargetDifficulty);
};

const createPuzzleBonus = (rating: number, runMedianDifficulty: number, bonusTargetDifficulty: number): BonusChallenge => {
  for (let tries = 0; tries < 120; tries += 1) {
    const candidate = generateAdaptivePuzzleItem(clamp(Math.max(rating, bonusTargetDifficulty), 950, 1700), new Set<string>());
    const label = difficultyLabelFromScore(candidate.difficulty);
    const minDifficulty = Math.max(
      1030,
      Math.min(1340, bonusTargetDifficulty),
      Math.min(runMedianDifficulty + 60, 1340)
    );
    if (!HARD_LABELS.has(label)) continue;
    if (candidate.difficulty < minDifficulty) continue;
    return puzzleToBonusChallenge(candidate, runMedianDifficulty, bonusTargetDifficulty);
  }

  const fallback: PuzzleItem = {
    id: 'stars-16-bonus-fallback',
    type: 'puzzle',
    difficulty: 1110,
    tags: ['strategy', 'pattern'],
    title: 'Puzzle Nova',
    answer_type: 'choice',
    core_prompt:
      'There are 16 stars. You go first and can take 1, 2, or 3 each turn. Last star wins. Do you have a winning strategy?',
    core_answer: 'No',
    choices: ['Yes', 'No'],
    extensions: [],
    hint_ladder: [
      'Check small starts: 4 stars is a losing start.',
      'Multiples of 4 are losing starts with perfect play.',
      '16 is a multiple of 4.'
    ],
    solution_steps: [
      'With 4 stars, first player loses if both play perfectly.',
      'That pattern repeats at 8, 12, 16.',
      'So 16 starts as a losing position. Answer: No.'
    ]
  };

  return puzzleToBonusChallenge(fallback, runMedianDifficulty, bonusTargetDifficulty);
};

export const buildBonusTarget = (rating: number, runDifficulties: number[]) => {
  const runMedianDifficulty = median(runDifficulties);
  const bonusTargetDifficulty = clamp(Math.max(rating + 120, runMedianDifficulty + 150), 980, 1600);
  return { runMedianDifficulty, bonusTargetDifficulty };
};

export const createBonusChallenge = (
  gameMode: BonusGameMode,
  lastSegment: BonusLastSegment,
  rating: number,
  runDifficulties: number[]
): BonusChallenge => {
  const { runMedianDifficulty, bonusTargetDifficulty } = buildBonusTarget(rating, runDifficulties);

  if (gameMode === 'rocket_rush') {
    return createFastMathBonus(rating, runMedianDifficulty, bonusTargetDifficulty);
  }

  if (gameMode === 'puzzle_orbit') {
    return createPuzzleBonus(rating, runMedianDifficulty, bonusTargetDifficulty);
  }

  if (lastSegment === 'flow') {
    return createFastMathBonus(rating, runMedianDifficulty, bonusTargetDifficulty);
  }

  return makeStrictFractionCandidate(runMedianDifficulty, bonusTargetDifficulty)
    ?? createHardFractionFallback(runMedianDifficulty, bonusTargetDifficulty);
};

export const fallbackBonusChallenge: BonusChallenge = createHardFractionFallback(950, 1100);

export const bonusPointsTarget = (
  challenge: BonusChallenge,
  gameMode: BonusGameMode
): 'fast_math' | 'puzzle' => {
  if (challenge.flavor === 'fast_math') return 'fast_math';
  if (challenge.flavor === 'puzzle' || challenge.flavor === 'fraction') return 'puzzle';
  return gameMode === 'rocket_rush' ? 'fast_math' : 'puzzle';
};

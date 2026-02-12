import { chooseTargetDifficulty } from './adaptive';
import type { PuzzleItem } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(items: T[]): T => items[randInt(0, items.length - 1)];

type PuzzleTemplate = {
  key: string;
  minDifficulty: number;
  maxDifficulty: number;
  build: (difficulty: number) => Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string };
};

const extensions = (one: string, two: string) => [
  { label: 'Bonus 1', prompt: one, answer: 'varies' },
  { label: 'Bonus 2', prompt: two, answer: 'varies' }
];

const pairCountPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const n = randInt(5, 11);
  const answer = (n * (n - 1)) / 2;
  return {
    signature: `pairs-${n}`,
    tags: ['counting', 'logic'],
    title: 'Star Team Pairs',
    answer_type: 'short_text',
    core_prompt: `${n} space cadets each high-five every other cadet once. How many high-fives total?`,
    core_answer: String(answer),
    hint_ladder: [
      'Try with 4 cadets first.',
      'Count unique pairs, not people.',
      'Use this pattern: students × (students - 1) ÷ 2.',
      `Reveal: ${n}×${n - 1}/2 = ${answer}.`
    ],
    solution_steps: [`Pairs = ${n}(${n} - 1)/2.`, `Answer: ${answer}.`],
    extensions: extensions('How many with 12 cadets?', 'Write a rule for n cadets.')
  };
};

const yesNoAreaPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const side = pick([4, 5, 6, 7, 8]);
  const a = randInt(2, side * 2);
  const b = (side * side) / a;
  const integerB = Number.isInteger(b);
  const displayB = integerB ? String(b) : (Math.round(b * 10) / 10).toString();
  return {
    signature: `area-yn-${side}-${a}-${displayB}`,
    tags: ['spatial', 'geometry_area'],
    title: 'Shape Shift Check',
    answer_type: 'choice',
    core_prompt: `Can a ${side}x${side} square be rearranged into a ${a}x${displayB} rectangle (no stretching)?`,
    core_answer: 'Yes',
    hint_ladder: [
      'Area must stay the same.',
      `Square area is ${side * side}.`,
      `Rectangle area is ${a}×${displayB}.`,
      `Reveal: both are ${side * side}.`
    ],
    solution_steps: [`Square area = ${side * side}.`, `Rectangle area = ${side * side}, so yes.`],
    extensions: extensions('Name another rectangle with the same area.', 'What never changes in cut-and-rearrange puzzles?')
  };
};

const alwaysSometimesNeverPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const variant = pick([
    { prompt: 'For counting number n, n(n+1) is even.', answer: 'Always', reason: 'one of two back-to-back numbers is always even' },
    { prompt: 'For counting number n, n² - n is even.', answer: 'Always', reason: 'n(n-1) includes one even number' },
    { prompt: 'For counting number n, n² + 1 is odd.', answer: 'Sometimes', reason: 'it depends on whether n is odd or even' }
  ]);

  return {
    signature: `asn-${variant.prompt}`,
    tags: ['proof_lite', 'reasoning'],
    title: 'Always / Sometimes / Never',
    answer_type: 'choice',
    core_prompt: variant.prompt,
    core_answer: variant.answer,
    hint_ladder: [
      'Try a few small values for n.',
      'Look for an odd/even pattern.',
      'Rewrite the expression if that helps.',
      `Reveal: ${variant.reason}.`
    ],
    solution_steps: [variant.reason, `So the best label is ${variant.answer}.`],
    extensions: extensions('Test n=1..6 and list outcomes.', 'How would you prove it quickly?')
  };
};

const switchPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  return {
    signature: `switch-${randInt(1, 9999)}`,
    tags: ['logic', 'strategy'],
    title: 'Switch & Lamps',
    answer_type: 'long_text',
    core_prompt: '3 switches control 3 lamps in another room. One trip allowed. What is your plan?',
    core_answer: 'use heat',
    accept_answers: ['one switch long', 'warm bulb', 'turn one on then off'],
    hint_ladder: [
      'Use more than just on/off.',
      'Heat can act like a clue.',
      'One on long, one on short, one off.',
      'Reveal: identify lamps by light + warmth.'
    ],
    solution_steps: ['Use timing to create warm vs cold clues.', 'Match each lamp by light state and bulb temperature.'],
    extensions: extensions('How could this scale to 4 lamps?', 'Why does heat add information?')
  };
};

const templates: PuzzleTemplate[] = [
  { key: 'pairs', minDifficulty: 900, maxDifficulty: 1150, build: () => pairCountPuzzle() },
  { key: 'area_yn', minDifficulty: 980, maxDifficulty: 1250, build: () => yesNoAreaPuzzle() },
  { key: 'asn', minDifficulty: 1120, maxDifficulty: 1420, build: () => alwaysSometimesNeverPuzzle() },
  { key: 'switch', minDifficulty: 1280, maxDifficulty: 1700, build: () => switchPuzzle() }
];

const pickTemplate = (difficulty: number): PuzzleTemplate => {
  const eligible = templates.filter((template) => difficulty >= template.minDifficulty - 80 && difficulty <= template.maxDifficulty + 80);
  return eligible.length ? pick(eligible) : templates[0];
};

const buildCandidate = (targetDifficulty: number): PuzzleItem => {
  const difficulty = clamp(Math.round(targetDifficulty + randInt(-60, 60)), 900, 1700);
  const template = pickTemplate(difficulty);
  const built = template.build(difficulty);
  return {
    id: `${template.key}-${built.signature}`,
    type: 'puzzle',
    difficulty,
    ...built
  };
};

export const generateAdaptivePuzzleItem = (
  rating: number,
  usedIds: Set<string>,
  prevDifficulty?: number
): PuzzleItem => {
  const target = chooseTargetDifficulty(rating);
  const candidates = Array.from({ length: 20 }, () => buildCandidate(target));
  const fresh = candidates.filter((candidate) => !usedIds.has(candidate.id));
  const pool = fresh.length ? fresh : candidates;
  const scored = pool.map((item) => {
    const jumpPenalty = prevDifficulty === undefined ? 0 : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - 110) * 2.8;
    return { item, score: Math.abs(item.difficulty - target) + jumpPenalty };
  });
  scored.sort((a, b) => a.score - b.score);
  return pick(scored.slice(0, Math.min(4, scored.length))).item;
};

export const generateAdaptivePuzzleChoices = (rating: number, usedIds: Set<string>, count = 2): PuzzleItem[] => {
  const choices: PuzzleItem[] = [];
  const tempUsed = new Set(usedIds);
  while (choices.length < count) {
    const next = generateAdaptivePuzzleItem(rating, tempUsed, choices[choices.length - 1]?.difficulty);
    tempUsed.add(next.id);
    choices.push(next);
  }
  return choices;
};

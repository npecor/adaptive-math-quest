import { difficultyLabelFromScore, type DifficultyLabel } from './difficulty-tags';
import { generateBonusPuzzle } from './puzzle-generator';
import type { PuzzleItem } from './types';

export type BonusGameMode = 'galaxy_mix' | 'rocket_rush' | 'puzzle_orbit';
export type BonusLastSegment = 'flow' | 'puzzle';

export type BonusChallenge = {
  id: string;
  title: string;
  prompt: string;
  choices: string[];
  answer: string;
  answerType: 'choice' | 'short_text' | 'long_text';
  acceptAnswers: string[];
  hintLadder: string[];
  solutionSteps: string[];
  difficulty: number;
  label: DifficultyLabel;
  puzzleType: NonNullable<PuzzleItem['puzzleType']>;
  templateKey: string;
  runMedianDifficulty: number;
  bonusTargetDifficulty: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const median = (values: number[]) => {
  if (values.length === 0) return 950;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const toExplicitChoices = (puzzle: PuzzleItem) => {
  if (puzzle.choices?.length) return puzzle.choices;
  const answer = puzzle.core_answer.trim().toLowerCase();
  if (answer === 'yes' || answer === 'no') return ['Yes', 'No'];
  if (['always', 'sometimes', 'never'].includes(answer)) return ['Always', 'Sometimes', 'Never'];
  return [];
};

const puzzleToBonusChallenge = (
  puzzle: PuzzleItem,
  runMedianDifficulty: number,
  bonusTargetDifficulty: number
): BonusChallenge => {
  const label = difficultyLabelFromScore(puzzle.difficulty);
  return {
    id: `bonus-${puzzle.id}`,
    title: puzzle.title.trim() || 'Mini Boss',
    prompt: puzzle.core_prompt,
    choices: toExplicitChoices(puzzle),
    answer: puzzle.core_answer,
    answerType: puzzle.answer_type ?? (toExplicitChoices(puzzle).length ? 'choice' : 'short_text'),
    acceptAnswers: puzzle.accept_answers ?? [],
    hintLadder: (puzzle.hint_ladder ?? []).slice(0, 3),
    solutionSteps: (puzzle.solution_steps ?? []).slice(0, 3),
    difficulty: puzzle.difficulty,
    label,
    puzzleType: puzzle.puzzleType ?? 'logic',
    templateKey: puzzle.id.split('-')[0] ?? 'puzzle',
    runMedianDifficulty,
    bonusTargetDifficulty
  };
};

const fallbackBonusPuzzle: PuzzleItem = {
  id: 'constraint_switch-bonus-fallback',
  type: 'puzzle',
  difficulty: 1360,
  puzzleType: 'constraint',
  tags: ['constraint', 'logic', 'one_chance'],
  title: 'Switch Mission',
  answer_type: 'choice',
  choices: [
    'Turn one on for a while, switch it off, turn a second on, then check heat and light.',
    'Turn all three on, wait, then check only brightness.',
    'Turn one on and immediately run upstairs.',
    'Flip random switches quickly and guess.'
  ],
  core_prompt: 'Three switches control three lamps in another room. You only get one visit upstairs. What plan works?',
  core_answer: 'Turn one on for a while, switch it off, turn a second on, then check heat and light.',
  extensions: [],
  hint_ladder: [
    'Use more than just on or off.',
    'Warm bulbs give extra information after a switch is off.',
    'Create three states: on, warm-off, and cold-off.'
  ],
  solution_steps: [
    'Turn Switch A on and wait so one bulb becomes warm.',
    'Turn A off, turn B on, and keep C off before your one trip.',
    'Upstairs: glowing is B, warm dark is A, cold dark is C.'
  ]
};

export const buildBonusTarget = (rating: number, runDifficulties: number[]) => {
  const runMedianDifficulty = median(runDifficulties);
  const bonusTargetDifficulty = clamp(Math.max(rating + 120, runMedianDifficulty + 150), 980, 1600);
  return { runMedianDifficulty, bonusTargetDifficulty };
};

export const createBonusChallenge = (
  _gameMode: BonusGameMode,
  _lastSegment: BonusLastSegment,
  rating: number,
  runDifficulties: number[]
): BonusChallenge => {
  const { runMedianDifficulty, bonusTargetDifficulty } = buildBonusTarget(rating, runDifficulties);
  const miniBossPuzzle = generateBonusPuzzle(rating, runMedianDifficulty, bonusTargetDifficulty);
  return puzzleToBonusChallenge(miniBossPuzzle, runMedianDifficulty, bonusTargetDifficulty);
};

export const fallbackBonusChallenge: BonusChallenge = puzzleToBonusChallenge(fallbackBonusPuzzle, 950, 1100);

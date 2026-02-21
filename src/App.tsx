import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { updateRating } from './lib/adaptive';
import { difficultyLabelFromScore, type DifficultyLabel } from './lib/difficulty-tags';
import { createBonusChallenge, fallbackBonusChallenge, type BonusChallenge } from './lib/bonus-generator';
import { generateAdaptiveFlowItem } from './lib/flow-generator';
import { fetchLeaderboard, registerPlayer, upsertScore, type LeaderboardMode, type LeaderboardRow } from './lib/leaderboard-api';
import { generateAdaptivePuzzleChoices } from './lib/puzzle-generator';
import { applyStarAward, buildLeaderboardEntries, completeRunTotals, getLeaderboardPrimaryValue, recalcTotals, sortLeaderboardRows, upsertSolvedPuzzleIds } from './lib/progress';
import { loadState, saveState } from './lib/storage';
import { updateDailyStreak, updatePuzzleStreak } from './lib/streaks';
import type { AppState, FlowItem, PuzzleItem } from './lib/types';
import './styles.css';

type Screen = 'landing' | 'onboarding' | 'home' | 'run' | 'summary' | 'scores' | 'museum';
type BrandVariant = 'classic' | 'simplified';
type FeedbackTone = 'success' | 'error' | 'info';
type CoachVisualRow = { label: string; value: number; detail: string; color: string };
type CoachVisualData = { kind?: 'bars' | 'fraction_line'; title: string; caption: string; rows: CoachVisualRow[]; guide?: string[] };
type GameMode = 'galaxy_mix' | 'rocket_rush' | 'puzzle_orbit';
type PlayerCharacter = {
  id: string;
  emoji: string;
  name: string;
  vibe: string;
  kind: 'astronaut' | 'animal';
};

interface RunState {
  phase: 'flow' | 'puzzle_pick' | 'puzzle' | 'boss';
  bossStage: 'intro' | 'question' | 'result';
  gameMode: GameMode;
  flowTarget: number;
  puzzleTarget: number;
  flowDone: number;
  puzzleDone: number;
  sprintScore: number;
  brainScore: number;
  currentFlow?: FlowItem;
  currentPuzzleChoices: PuzzleItem[];
  currentPuzzle?: PuzzleItem;
  currentHints: number;
  usedFlowIds: Set<string>;
  usedPuzzleIds: Set<string>;
  recentTemplates: string[];
  recentShapes: string[];
  recentPatternTags: string[];
  flowStreak: number;
  runDifficultySamples: number[];
  bonusChallenge?: BonusChallenge;
  starsThisRound: number;
  puzzlesSolvedThisRound: number;
  puzzlesTriedThisRound: number;
}

type PendingBonusFinish = {
  bossAttempted: boolean;
  runSnapshot: RunState;
  baseState: AppState;
};

const FLOW_TARGET = 8;
const PUZZLE_TARGET = 3;
const MAX_PUZZLE_HINTS = 3;
const NEW_PLAYER_ONRAMP_ATTEMPTS = 6;
const NEW_PLAYER_FLOW_MAX_DIFFICULTY = 1049; // Easy/Medium cap
const GLOBAL_LEADERBOARD_MIN_STARS = 21; // must be > 20 to appear globally
const LANDING_SEEN_STORAGE_KEY = 'galaxy-genius:landing-seen:v1';
const ACTIVITY_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const SHOW_TROPHY_ACTIVITY_CARD = false;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const playerCharacters: PlayerCharacter[] = [
  { id: 'astro-bot', emoji: '🤖', name: 'Astro Bot', vibe: 'Cheerful robot astronaut', kind: 'astronaut' },
  { id: 'animal-axo-naut', emoji: '🦎', name: 'Axo Naut', vibe: 'Coral pink explorer', kind: 'animal' },
  { id: 'animal-jelly-jet', emoji: '🪼', name: 'Jelly Jet', vibe: 'Floaty neon jellyfish', kind: 'animal' },
  { id: 'astro-cactus-cadet', emoji: '🌵', name: 'Cactus Comet', vibe: 'Spiky + silly', kind: 'astronaut' },
  { id: 'animal-stardust-fish', emoji: '⭐', name: 'Stardust Fish', vibe: 'Sparkly star swimmer', kind: 'animal' },
  { id: 'animal-moon-mochi', emoji: '🌙', name: 'Moon Mochi', vibe: 'Soft moon mochi in a helmet', kind: 'animal' },
  { id: 'animal-glowing-gloop', emoji: '🟣', name: 'Glowing Gloop', vibe: 'Purple cosmic blob', kind: 'animal' },
  { id: 'animal-alien-al', emoji: '👽', name: 'Alien Al', vibe: 'Classic space explorer', kind: 'animal' },
  { id: 'entity-black-hole', emoji: '🕳️', name: 'Black Hole', vibe: 'Tiny singularity buddy', kind: 'animal' },
  { id: 'animal-cosmo-cat', emoji: '🐱', name: 'Cosmo Cat', vibe: 'Solar flares + mischief', kind: 'animal' }
];
const defaultCharacterId = playerCharacters[0].id;
const characterPaletteById: Record<string, { base: string; accent: string; trim: string; mark: string }> = {
  'astro-cactus-cadet': { base: '#d9f99d', accent: '#84cc16', trim: '#fef08a', mark: '#365314' },
  'astro-bot': { base: '#f8fafc', accent: '#60a5fa', trim: '#e2e8f0', mark: '#0f172a' },
  'animal-axo-naut': { base: '#f9a8d4', accent: '#fb7185', trim: '#fecdd3', mark: '#3f1d2e' },
  'animal-stardust-fish': { base: '#67e8f9', accent: '#06b6d4', trim: '#bae6fd', mark: '#0f172a' },
  'animal-moon-mochi': { base: '#f8fafc', accent: '#c084fc', trim: '#e9d5ff', mark: '#1e293b' },
  'animal-glowing-gloop': { base: '#ff9f40', accent: '#ff3c00', trim: '#ffd8aa', mark: '#2a0000' },
  'animal-alien-al': { base: '#a8d5ba', accent: '#3498db', trim: '#d1fae5', mark: '#2c3e50' },
  'entity-black-hole': { base: '#0b1025', accent: '#5419e0', trim: '#00d2ff', mark: '#ffffff' },
  'animal-jelly-jet': { base: '#c4b5fd', accent: '#7c3aed', trim: '#e9d5ff', mark: '#312e81' },
  'animal-cosmo-cat': { base: '#fdba74', accent: '#f59e0b', trim: '#fde68a', mark: '#7c2d12' }
};
const characterVariantById: Record<string, string> = {
  'astro-cactus-cadet': 'cactus-cadet',
  'astro-bot': 'astro-bot',
  'animal-axo-naut': 'axo-naut',
  'animal-stardust-fish': 'stardust-fish',
  'animal-moon-mochi': 'moon-mochi',
  'animal-glowing-gloop': 'glowing-gloop',
  'animal-alien-al': 'alien-al',
  'entity-black-hole': 'black-hole',
  'animal-jelly-jet': 'jelly-jet',
  'animal-cosmo-cat': 'cosmo-cat'
};

const modeConfig: Record<GameMode, { name: string; icon: string; subtitle: string; flowTarget: number; puzzleTarget: number }> = {
  galaxy_mix: { name: 'Mission Mix', icon: '🪐', subtitle: 'Quick math + puzzles', flowTarget: FLOW_TARGET, puzzleTarget: PUZZLE_TARGET },
  rocket_rush: { name: 'Rocket Rush', icon: '🚀', subtitle: 'Fast math only', flowTarget: 12, puzzleTarget: 0 },
  puzzle_orbit: { name: 'Puzzle Planet', icon: '🧩', subtitle: 'Logic puzzles only', flowTarget: 0, puzzleTarget: 5 }
};

const newRun = (mode: GameMode = 'galaxy_mix'): RunState => ({
  phase: modeConfig[mode].flowTarget > 0 ? 'flow' : 'puzzle_pick',
  bossStage: 'intro',
  gameMode: mode,
  flowTarget: modeConfig[mode].flowTarget,
  puzzleTarget: modeConfig[mode].puzzleTarget,
  flowDone: 0,
  puzzleDone: 0,
  sprintScore: 0,
  brainScore: 0,
  currentPuzzleChoices: [],
  currentHints: 0,
  usedFlowIds: new Set<string>(),
  usedPuzzleIds: new Set<string>(),
  recentTemplates: [],
  recentShapes: [],
  recentPatternTags: [],
  flowStreak: 0,
  runDifficultySamples: [],
  bonusChallenge: undefined,
  starsThisRound: 0,
  puzzlesSolvedThisRound: 0,
  puzzlesTriedThisRound: 0
});

const normalize = (s: string) => s.trim().toLowerCase();
const canonicalizeAnswer = (s: string) =>
  normalize(s)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'"`]+|[\s'"`]+$/g, '')
    .replace(/[.,!?;:]+$/g, '');

const parseLooseNumber = (s: string): number | null => {
  const cleaned = canonicalizeAnswer(s).replace(/,/g, '');
  if (!cleaned) return null;

  const fractionMatch = cleaned.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
    return numerator / denominator;
  }

  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
};

const isSmartAnswerMatch = (input: string, validAnswers: string[]): boolean => {
  const canonicalInput = canonicalizeAnswer(input);
  const canonicalAnswers = validAnswers.map(canonicalizeAnswer);
  if (canonicalAnswers.includes(canonicalInput)) return true;

  const inputNumber = parseLooseNumber(input);
  if (inputNumber === null) return false;

  return validAnswers.some((answer) => {
    const answerNumber = parseLooseNumber(answer);
    return answerNumber !== null && Math.abs(answerNumber - inputNumber) < 1e-9;
  });
};

const expectsNumericInput = (primaryAnswer: string, acceptAnswers?: string[]): boolean => {
  if (parseLooseNumber(primaryAnswer) === null) return false;
  if (!acceptAnswers?.length) return true;
  return acceptAnswers.every((answer) => parseLooseNumber(answer) !== null);
};

const getTier = (
  difficulty: number,
  explicitTier?: DifficultyLabel
): { label: DifficultyLabel; icon: string; flowPoints: number; puzzlePoints: number } => {
  const label = explicitTier ?? difficultyLabelFromScore(difficulty);
  if (label === 'Master') return { label, icon: '🧭', flowPoints: 22, puzzlePoints: 66 };
  if (label === 'Expert') return { label, icon: '🎖️', flowPoints: 18, puzzlePoints: 54 };
  if (label === 'Hard') return { label, icon: '🚀', flowPoints: 15, puzzlePoints: 45 };
  if (label === 'Medium') return { label, icon: '🛰️', flowPoints: 12, puzzlePoints: 36 };
  return { label, icon: '🧑‍🚀', flowPoints: 10, puzzlePoints: 30 };
};

const getPuzzleAnswerChoices = (answer: string): string[] | null => {
  const normalized = normalize(answer);
  if (normalized === 'yes' || normalized === 'no') return ['Yes', 'No'];
  if (normalized === 'always' || normalized === 'sometimes' || normalized === 'never') {
    return ['Always', 'Sometimes', 'Never'];
  }
  return null;
};

const getPuzzleChoiceOptions = (puzzle: PuzzleItem): string[] => {
  if (puzzle.choices?.length) return puzzle.choices;
  return getPuzzleAnswerChoices(puzzle.core_answer) ?? [];
};

const cleanChoiceMarker = (text: string) =>
  text
    .replace(/^\s*[A-Z]\)\s*/g, '')
    .replace(/\s+[A-Z]\)\s+/g, ' ')
    .trim();

const cleanPuzzlePromptDisplay = (prompt: string) =>
  prompt
    .split('\n')
    .map((line) => cleanChoiceMarker(line))
    .join('\n');

const getPuzzleInputMode = (puzzle: PuzzleItem): 'choice' | 'short_text' | 'long_text' => {
  if (puzzle.answer_type) return puzzle.answer_type;
  if (getPuzzleAnswerChoices(puzzle.core_answer)) return 'choice';
  return 'short_text';
};

const getBonusInputMode = (bonus: BonusChallenge): 'choice' | 'short_text' | 'long_text' => {
  if (bonus.answerType) return bonus.answerType;
  if (bonus.choices.length > 0) return 'choice';
  return 'short_text';
};

const getBonusChoiceOptions = (bonus: BonusChallenge): string[] => {
  const deduped = Array.from(new Set(bonus.choices));
  if (deduped.length <= 3) return deduped;

  const answerIdx = deduped.findIndex((choice) => normalize(choice) === normalize(bonus.answer));
  const answerChoice = answerIdx >= 0 ? deduped[answerIdx] : deduped[0];
  const distractors = deduped.filter((choice) => normalize(choice) !== normalize(answerChoice));
  return [answerChoice, ...distractors.slice(0, 2)];
};

const getPuzzlePlainLanguage = (puzzle: PuzzleItem): string => {
  const prompt = puzzle.core_prompt;
  const normalized = normalize(prompt);

  if (normalized.includes('high-five every other')) {
    return 'Count how many unique pairs can be made. Each pair gives one high-five.';
  }

  if (normalized.includes('can a') && normalized.includes('square') && normalized.includes('rectangle')) {
    return 'Decide if both shapes have the same area. If area matches, the answer is yes.';
  }

  if (normalized.includes('switches') && normalized.includes('lamps')) {
    return 'Explain your one-trip plan to figure out which switch controls each lamp.';
  }

  return `In simple words: ${prompt}`;
};

const isPuzzleAnswerCorrect = (puzzle: PuzzleItem, rawInput: string): boolean => {
  const inputText = canonicalizeAnswer(rawInput);
  const answers = [puzzle.core_answer, ...(puzzle.accept_answers ?? [])];
  if (isSmartAnswerMatch(rawInput, answers)) return true;

  if (getPuzzleInputMode(puzzle) === 'long_text') {
    return answers
      .map(canonicalizeAnswer)
      .some((answer) => answer.length >= 4 && inputText.includes(answer));
  }

  return false;
};

const getClarifyingReply = (puzzle: PuzzleItem, question: string, hintsShown: number): string => {
  const q = normalize(question);
  const mode = getPuzzleInputMode(puzzle);
  const nextHint = puzzle.hint_ladder[Math.min(hintsShown, puzzle.hint_ladder.length - 1)];

  if (
    q.includes('what does this question mean') ||
    q.includes('what does it mean') ||
    q.includes('what does this mean') ||
    q.includes('what is this asking') ||
    q.includes('i do not understand')
  ) {
    return getPuzzlePlainLanguage(puzzle);
  }

  if (q.includes('what') && (q.includes('ask') || q.includes('find') || q.includes('solve') || q.includes('do'))) {
    return getPuzzlePlainLanguage(puzzle);
  }

  if (q.includes('format') || q.includes('type') || q.includes('answer')) {
    if (mode === 'choice') return 'Tap one of the answer buttons, then hit Blast Off!';
    if (mode === 'long_text') return 'Write one short explanation sentence, then hit Blast Off!';
    return 'Type a short answer, then hit Blast Off!';
  }

  if (q.includes('stuck') || q.includes('hint') || q.includes('help')) {
    return `Try this clue: ${nextHint}`;
  }

  if (q.includes('example')) {
    return `Try a tiny version first, then return to this puzzle. ${nextHint}`;
  }

  return 'Great question. Focus on what stays the same, then answer the core prompt in one step.';
};

const phaseLabel = (phase: RunState['phase']) => {
  if (phase === 'flow') return 'Quick Questions';
  if (phase === 'puzzle_pick') return 'Pick a Puzzle';
  if (phase === 'puzzle') return 'Puzzle Time';
  return 'Bonus Round';
};

const getCharacterById = (characterId?: string) => {
  const normalizedId =
    characterId === 'animal-captain-paws'
      ? 'animal-cosmo-cat'
      : characterId;
  return playerCharacters.find((character) => character.id === normalizedId);
};

const toFriendlyPuzzleTitle = (title?: string, puzzleId?: string) => {
  if (title && title.trim() && !/^puz_\d+$/i.test(title.trim())) return title;
  const legacyNameByNumber = [
    'Meteor Match',
    'Orbit Logic',
    'Comet Count',
    'Galaxy Grid',
    'Rocket Riddle',
    'Moon Maze',
    'Star Switch',
    'Planet Pattern',
    'Alien Angles',
    'Nebula Numbers',
    'Cosmic Compare',
    'Astro Sequence'
  ];
  const legacyMatch = puzzleId?.match(/^puz_(\d+)/i);
  if (legacyMatch) {
    const idx = Number(legacyMatch[1]) - 1;
    return legacyNameByNumber[idx] ?? `Star Puzzle #${Number(legacyMatch[1])}`;
  }

  if (puzzleId?.startsWith('pairs-')) return 'Star Team Pairs';
  if (puzzleId?.startsWith('area_yn-')) return 'Shape Shift Check';
  if (puzzleId?.startsWith('asn-')) return 'Always / Sometimes / Never';
  if (puzzleId?.startsWith('switch-')) return 'Switch & Lamps';

  const match = puzzleId?.match(/(\d+)/);
  if (match) return `Star Puzzle #${Number(match[1])}`;
  return 'Puzzle Challenge';
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const pickBySeed = (items: string[], seed: string) => items[hashString(seed) % items.length];
const randomCadetName = () => {
  const starts = ['Star', 'Nova', 'Comet', 'Orbit', 'Rocket', 'Cosmo', 'Lunar', 'Solar'];
  const ends = ['Scout', 'Pilot', 'Whiz', 'Ranger', 'Spark', 'Genius', 'Cadet', 'Quest'];
  const start = starts[Math.floor(Math.random() * starts.length)];
  const end = ends[Math.floor(Math.random() * ends.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${start}${end}${num}`;
};
const getPuzzleEmoji = (puzzle: { id?: string; title?: string; tags?: string[]; answer_type?: string }) => {
  const seed = `${puzzle.id ?? ''}-${puzzle.title ?? ''}`;
  const tags = puzzle.tags ?? [];
  const title = normalize(puzzle.title ?? '');

  if (tags.includes('geometry_area') || tags.includes('spatial')) return pickBySeed(['📐', '🧊', '🛰️', '🧩'], seed);
  if (tags.includes('counting')) return pickBySeed(['⭐', '🧮', '🌠', '✨'], seed);
  if (tags.includes('reasoning') || tags.includes('proof_lite')) return pickBySeed(['🧠', '🔍', '🌀', '💡'], seed);
  if (tags.includes('logic') || puzzle.answer_type === 'long_text') return pickBySeed(['🔦', '🧪', '🛰️', '🛸'], seed);
  if (title.includes('switch') || title.includes('lamp')) return pickBySeed(['💡', '🔌', '🔦'], seed);

  return pickBySeed(['🛸', '🪐', '🌌', '💫', '👾'], seed);
};

const formatCoachNumber = (value: number) => {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, '');
};

const getGeometryCoachLine = (prompt: string) => {
  const text = prompt.toLowerCase();
  const triangleMatch = prompt.match(/base\s+(\d+(?:\.\d+)?)\s+and\s+height\s+(\d+(?:\.\d+)?)/i);
  if (text.includes('triangle') && triangleMatch) {
    const base = Number(triangleMatch[1]);
    const height = Number(triangleMatch[2]);
    const product = base * height;
    const area = product / 2;
    return `Triangle area = base × height ÷ 2. So ${formatCoachNumber(base)} × ${formatCoachNumber(height)} = ${formatCoachNumber(product)}, then ÷ 2 = ${formatCoachNumber(area)}.`;
  }

  const rectMatch = prompt.match(/rectangle\s+(\d+(?:\.\d+)?)\s+by\s+(\d+(?:\.\d+)?)/i);
  if (text.includes('rectangle') && rectMatch) {
    const length = Number(rectMatch[1]);
    const width = Number(rectMatch[2]);
    const area = length * width;
    return `Rectangle area = length × width. So ${formatCoachNumber(length)} × ${formatCoachNumber(width)} = ${formatCoachNumber(area)}.`;
  }

  return 'Find area: length × width (or base × height ÷ 2).';
};

const simplifyCoachLine = (line: string) =>
  line
    .replace(/divisor/gi, 'second number')
    .replace(/dividend/gi, 'first number')
    .replace(/supplementary/gi, 'that make a straight line')
    .replace(/LCM/gi, 'common multiple')
    .replace(/\s+/g, ' ')
    .trim();

type TutorBreakPlan = {
  original: number;
  partA: number;
  partB: number;
  rewriteLine: string;
  partLineA: string;
  partLineB: string;
  valueA: number;
  valueB: number;
};

const splitTutorNumber = (value: number): [number, number] => {
  if (value >= 12) {
    const tens = Math.floor(value / 10) * 10;
    const ones = value - tens;
    if (ones > 0) return [tens, ones];
    const half = Math.floor(value / 2);
    return [half, value - half];
  }
  if (value >= 4) return [value - 2, 2];
  return [value - 1, 1];
};

const buildTutorBreakPlan = (left: number, right: number): TutorBreakPlan => {
  const splitRight = (right >= 10 && right % 10 !== 0) || (left < 10 && right >= left);
  const original = splitRight ? right : left;
  const [partA, partB] = splitTutorNumber(original);

  if (splitRight) {
    const valueA = left * partA;
    const valueB = left * partB;
    return {
      original,
      partA,
      partB,
      rewriteLine: `${left}×${right} = ${left}×${partA} + ${left}×${partB}`,
      partLineA: `${left}×${partA}`,
      partLineB: `${left}×${partB}`,
      valueA,
      valueB
    };
  }

  const valueA = partA * right;
  const valueB = partB * right;
  return {
    original,
    partA,
    partB,
    rewriteLine: `${left}×${right} = ${partA}×${right} + ${partB}×${right}`,
    partLineA: `${partA}×${right}`,
    partLineB: `${partB}×${right}`,
    valueA,
    valueB
  };
};

const buildFractionVisual = (text: string): CoachVisualData | null => {
  const matches = [...text.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
    .slice(0, 2)
    .map((match) => {
      const numerator = Number(match[1]);
      const denominator = Number(match[2]);
      if (!denominator) return null;
      const decimal = numerator / denominator;
      return {
        label: `${numerator}/${denominator}`,
        value: Math.max(0, Math.min(1, decimal)),
        detail: decimal.toFixed(3)
      };
    })
    .filter((entry): entry is { label: string; value: number; detail: string } => Boolean(entry));

  if (matches.length < 2) return null;

  const [left, right] = matches;
  const winner = left.value === right.value ? 'Tie' : left.value > right.value ? left.label : right.label;
  const palette = ['#38bdf8', '#a78bfa'];
  return {
    kind: 'fraction_line',
    title: 'Fraction picture',
    caption: 'The mark farther right is larger.',
    rows: matches.map((entry, index) => ({ ...entry, color: palette[index % palette.length] })),
    guide: [
      'Step A: Turn each fraction into a decimal.',
      'Step B: Put both marks on the same 0 to 1 line.',
      `Step C: Pick the one farther right (${winner}).`
    ]
  };
};

const buildPercentVisual = (text: string): CoachVisualData | null => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const percent = Number(match[1]);
  const base = Number(match[2]);
  if (!Number.isFinite(percent) || !Number.isFinite(base) || base <= 0) return null;

  const percentPart = (percent / 100) * base;
  const percentFill = Math.max(0, Math.min(1, percent / 100));
  return {
    title: 'Percent picture',
    caption: 'Percent means out of 100 parts.',
    rows: [
      {
        label: `100% of ${formatCoachNumber(base)}`,
        value: 1,
        detail: formatCoachNumber(base),
        color: '#64748b'
      },
      {
        label: `${formatCoachNumber(percent)}% of ${formatCoachNumber(base)}`,
        value: percentFill,
        detail: formatCoachNumber(percentPart),
        color: '#38bdf8'
      }
    ],
    guide: [
      'Step A: 100% means the whole amount.',
      'Step B: Change percent to decimal (like 25% = 0.25).',
      `Step C: Multiply by the whole (${formatCoachNumber(base)}).`
    ]
  };
};

const buildRatioVisual = (text: string): CoachVisualData | null => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*=\s*x\s*:\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const leftA = Number(match[1]);
  const leftB = Number(match[2]);
  const rightB = Number(match[3]);
  if (!leftA || !leftB || !rightB) return null;

  const scale = rightB / leftB;
  if (!Number.isFinite(scale)) return null;
  const solvedX = leftA * scale;
  const maxValue = Math.max(leftA, leftB, rightB, solvedX, 1);

  return {
    title: 'Ratio picture',
    caption: 'Both sides must grow by the same multiplier.',
    rows: [
      {
        label: `${formatCoachNumber(leftB)} → ${formatCoachNumber(rightB)}`,
        value: rightB / maxValue,
        detail: `×${formatCoachNumber(scale)}`,
        color: '#a78bfa'
      },
      {
        label: `${formatCoachNumber(leftA)} → x`,
        value: solvedX / maxValue,
        detail: `x = ${formatCoachNumber(solvedX)}`,
        color: '#22d3ee'
      }
    ],
    guide: [
      'Step A: Find how much one side grows.',
      `Step B: Here it grows by ×${formatCoachNumber(scale)}.`,
      'Step C: Grow the other side by that same amount.'
    ]
  };
};

const buildAreaVisual = (text: string): CoachVisualData | null => {
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/gi)]
    .slice(0, 2)
    .map((match) => {
      const left = Number(match[1]);
      const right = Number(match[2]);
      const area = left * right;
      if (!Number.isFinite(area)) return null;
      return {
        label: `${left}×${right}`,
        area
      };
    })
    .filter((entry): entry is { label: string; area: number } => Boolean(entry));

  if (matches.length < 2) return null;

  const maxArea = Math.max(...matches.map((entry) => entry.area), 1);
  const palette = ['#22d3ee', '#f472b6'];
  return {
    title: 'Area picture',
    caption: 'If areas match, you can cut and rearrange.',
    rows: matches.map((entry, index) => ({
      label: entry.label,
      value: entry.area / maxArea,
      detail: `Area ${entry.area}`,
      color: palette[index % palette.length]
    })),
    guide: [
      'Step A: Find area of each shape.',
      'Step B: Compare the two areas.',
      'Step C: Same area means rearrange is possible.'
    ]
  };
};

const getCoachVisual = (item: { tags: string[]; prompt?: string; core_prompt?: string }): CoachVisualData | null => {
  const text = item.prompt ?? item.core_prompt ?? '';
  if (!text) return null;

  if (item.tags.includes('fractions')) return buildFractionVisual(text);
  if (item.tags.includes('percents')) return buildPercentVisual(text);
  if (item.tags.includes('geometry_area') || item.tags.includes('spatial')) return buildAreaVisual(text);
  return null;
};

const CoachVisual = ({ visual }: { visual: CoachVisualData }) => (
  <div className="coach-visual">
    <p className="coach-visual-title">{visual.title}</p>
    {visual.kind === 'fraction_line' ? (
      <div className="coach-line-visual">
        <div className="coach-line-track">
          {visual.rows.map((row) => (
            <span
              key={`${row.label}-marker`}
              className="coach-line-marker"
              style={{ '--marker-left': `${Math.max(0, Math.min(100, row.value * 100))}%`, '--marker-color': row.color } as CSSProperties}
            />
          ))}
        </div>
        <div className="coach-pie-grid">
          {visual.rows.map((row) => (
            <div key={`${row.label}-${row.detail}`} className="coach-pie-card">
              <div className="coach-pie-meta">
                <span><InlineMathText text={row.label} /></span>
                <span>{row.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : (
      <div className="coach-visual-rows">
        {visual.rows.map((row) => (
          <div key={`${row.label}-${row.detail}`} className="coach-visual-row">
            <div className="coach-visual-row-head">
              <span><InlineMathText text={row.label} /></span>
              <span>{row.detail}</span>
            </div>
            <div className="coach-visual-track">
              <span className="coach-visual-fill" style={{ width: `${Math.max(10, Math.round(row.value * 100))}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    )}
    {visual.guide && visual.guide.length > 0 && (
      <div className="coach-guide">
        {visual.guide.map((step) => (
          <p key={step}>{step}</p>
        ))}
      </div>
    )}
    <p className="coach-visual-caption">{visual.caption}</p>
  </div>
);

const InlineMathText = ({ text }: { text: string }) => {
  const parts: ReactNode[] = [];
  const regex = /(\d+)\s*\/\s*(\d+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={`${match.index}-${match[0]}`} className="fraction-inline" aria-label={`${match[1]} over ${match[2]}`}>
        <span className="fraction-top">{match[1]}</span>
        <span className="fraction-bottom">{match[2]}</span>
      </span>
    );
    lastIndex = regex.lastIndex;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
};

const renderCharacterSprite = (variant: string, idPrefix: string) => {
  const shellId = `${idPrefix}-shell`;
  const orbId = `${idPrefix}-orb`;
  const haloId = `${idPrefix}-halo`;

  switch (variant) {
    case 'axo-naut':
      return (
        <>
          <ellipse cx="50" cy="52" rx="35" ry="31" fill="none" stroke="rgba(191,219,254,0.7)" strokeWidth="1.8" />
          <ellipse cx="18" cy="47" rx="7.5" ry="15.5" fill="#fb7185" />
          <ellipse cx="26" cy="39" rx="7" ry="12.5" fill="#fb7185" />
          <ellipse cx="32" cy="49" rx="6.5" ry="11.5" fill="#fb7185" />
          <ellipse cx="82" cy="47" rx="7.5" ry="15.5" fill="#fb7185" />
          <ellipse cx="74" cy="39" rx="7" ry="12.5" fill="#fb7185" />
          <ellipse cx="68" cy="49" rx="6.5" ry="11.5" fill="#fb7185" />
          <ellipse cx="50" cy="53" rx="30" ry="27" fill="#fff7fb" />
          <ellipse cx="50" cy="53" rx="30" ry="27" fill="none" stroke="#fecdd3" strokeWidth="2" />
          <ellipse cx="39" cy="51" rx="9.2" ry="10.2" className="character-avatar-eye" fill="#27272a" />
          <ellipse cx="61" cy="51" rx="9.2" ry="10.2" className="character-avatar-eye" fill="#27272a" />
          <circle cx="42" cy="48" r="2.2" fill="#fff" />
          <circle cx="64" cy="48" r="2.2" fill="#fff" />
          <ellipse cx="50" cy="60" rx="2.8" ry="2.1" fill="#3f3f46" />
          <path d="M46 66 Q50 69 54 66" className="character-avatar-mouth" />
          <circle cx="31" cy="54" r="2.1" fill="#fda4af" />
          <circle cx="69" cy="54" r="2.1" fill="#fda4af" />
          <polygon points="50,24 52,29 57,29 53,32 55,37 50,34 45,37 47,32 43,29 48,29" className="character-avatar-star" />
          <circle cx="24" cy="27" r="1.2" className="character-avatar-star" />
          <circle cx="76" cy="27" r="1.2" className="character-avatar-star" />
          <ellipse cx="41" cy="90" rx="7" ry="3" className="character-avatar-foot" />
          <ellipse cx="59" cy="90" rx="7" ry="3" className="character-avatar-foot" />
        </>
      );
    case 'cactus-cadet':
      return (
        <>
          <rect x="8" y="44" width="26" height="17" rx="8.5" fill="#bef264" transform="rotate(-18 21 52)" />
          <rect x="66" y="44" width="26" height="17" rx="8.5" fill="#bef264" transform="rotate(18 79 52)" />
          <rect x="24" y="28" width="52" height="54" rx="15" fill="#d9f99d" />
          <line x1="50" y1="28" x2="50" y2="14" stroke="#84cc16" strokeWidth="2.2" />
          <circle cx="50" cy="13" r="3.6" fill="#fef08a" />
          <circle cx="40" cy="50" r="7.3" fill="#f8fafc" />
          <circle cx="60" cy="50" r="7.3" fill="#f8fafc" />
          <circle cx="40" cy="50" r="2.7" className="character-avatar-eye" fill="#111827" />
          <circle cx="60" cy="50" r="2.7" className="character-avatar-eye" fill="#111827" />
          <path d="M45 61 Q50 66 55 61" className="character-avatar-mouth" />
          <rect x="27" y="76" width="46" height="18" rx="8" fill="#1f2937" />
          <ellipse cx="41" cy="90" rx="7" ry="3" className="character-avatar-foot" />
          <ellipse cx="59" cy="90" rx="7" ry="3" className="character-avatar-foot" />
          <circle cx="30" cy="37" r="1.3" fill="#365314" />
          <circle cx="72" cy="63" r="1.3" fill="#365314" />
          <circle cx="37" cy="68" r="1.1" fill="#365314" />
          <circle cx="63" cy="70" r="1.1" fill="#365314" />
          <path d="M33 33 Q50 23 67 33" fill="none" stroke="rgba(125,211,252,0.7)" strokeWidth="1.6" />
          <circle cx="50" cy="21" r="1.5" className="character-avatar-star" />
        </>
      );
    case 'stardust-fish':
      return (
        <>
          <defs>
            <linearGradient id={shellId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4facfe" />
              <stop offset="58%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <radialGradient id={orbId} cx="50%" cy="50%">
              <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="52" r="34" fill={`url(#${orbId})`} />
          <path
            d="M50 13 C55 13 60 27 67 32 C76 36 90 37 90 44 C90 50 76 57 73 66 C70 75 75 88 67 90 C60 93 50 78 50 78 C50 78 40 93 33 90 C25 88 30 75 27 66 C24 57 10 50 10 44 C10 37 24 36 33 32 C40 27 45 13 50 13 Z"
            fill={`url(#${shellId})`}
            stroke="#7dd3fc"
            strokeWidth="2.2"
          />
          <path
            d="M50 19 C54 19 58 30 64 34 C72 38 82 39 82 44 C82 49 72 55 70 62 C68 70 71 79 64 82 C58 85 50 72 50 72 C50 72 42 85 36 82 C29 79 32 70 30 62 C28 55 18 49 18 44 C18 39 28 38 36 34 C42 30 46 19 50 19 Z"
            fill="none"
            stroke="rgba(255,255,255,0.34)"
            strokeWidth="1.4"
          />
          <g transform="translate(0, 6)">
            <circle cx="41.5" cy="45.5" r="6.2" className="character-avatar-eye" fill="#0f172a" />
            <circle cx="58.5" cy="45.5" r="6.2" className="character-avatar-eye" fill="#0f172a" />
            <circle cx="43.2" cy="43.8" r="2" fill="#fff" />
            <circle cx="60.2" cy="43.8" r="2" fill="#fff" />
            <path d="M44.5 56.5 Q50 62 55.5 56.5" className="character-avatar-mouth" />
          </g>
          <circle cx="50" cy="50" r="35" fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth="1.7" />
          <path d="M30 33 Q50 21 70 33" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="33" cy="60" r="1.25" fill="#dbeafe" />
          <circle cx="67" cy="60" r="1.25" fill="#dbeafe" />
          <circle cx="23" cy="29" r="1.2" className="character-avatar-star" />
          <circle cx="77" cy="31" r="1.2" className="character-avatar-star" />
          <circle cx="50" cy="18" r="1.3" className="character-avatar-star" />
        </>
      );
    case 'moon-mochi':
      return (
        <>
          <defs>
            <linearGradient id={shellId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>
            <radialGradient id={orbId} cx="50%" cy="40%">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="52" r="35" fill={`url(#${orbId})`} />
          <ellipse cx="36" cy="33" rx="6.5" ry="13" fill="#e2e8f0" transform="rotate(-15 36 33)" />
          <ellipse cx="64" cy="33" rx="6.5" ry="13" fill="#e2e8f0" transform="rotate(15 64 33)" />
          <ellipse cx="36" cy="33" rx="3.3" ry="8" fill="#f3e8ff" transform="rotate(-15 36 33)" />
          <ellipse cx="64" cy="33" rx="3.3" ry="8" fill="#f3e8ff" transform="rotate(15 64 33)" />
          <ellipse cx="50" cy="55" rx="32" ry="27" fill={`url(#${shellId})`} />
          <ellipse cx="50" cy="55" rx="32" ry="27" fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
          <circle cx="33" cy="49" r="3" fill="#cbd5e1" fillOpacity="0.48" />
          <circle cx="68" cy="64" r="2.3" fill="#cbd5e1" fillOpacity="0.48" />
          <circle cx="64" cy="44" r="3.7" fill="#cbd5e1" fillOpacity="0.48" />
          <circle cx="43" cy="55" r="3.7" className="character-avatar-eye" fill="#1e293b" />
          <circle cx="57" cy="55" r="3.7" className="character-avatar-eye" fill="#1e293b" />
          <path d="M47 62 Q50 64.5 53 62" className="character-avatar-mouth" />
          <ellipse cx="40.5" cy="61.5" rx="2.8" ry="1.8" fill="#fbcfe8" fillOpacity="0.58" />
          <ellipse cx="59.5" cy="61.5" rx="2.8" ry="1.8" fill="#fbcfe8" fillOpacity="0.58" />
          <path d="M31 76 Q50 85 69 76 L69 84 Q50 92 31 84 Z" fill="#94a3b8" fillOpacity="0.84" />
          <circle cx="50" cy="50" r="37" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.7" />
          <path d="M28 31 Q38 21 48 23" stroke="rgba(255,255,255,0.6)" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="24" cy="27" r="1.1" className="character-avatar-star" />
          <circle cx="76" cy="29" r="1.1" className="character-avatar-star" />
        </>
      );
    case 'glowing-gloop':
      return (
        <>
          <defs>
            <radialGradient id={shellId} cx="34%" cy="30%" r="82%">
              <stop offset="0%" stopColor="#ffdd77" />
              <stop offset="32%" stopColor="#ff9f40" />
              <stop offset="66%" stopColor="#ff4d1f" />
              <stop offset="100%" stopColor="#5d0f12" />
            </radialGradient>
            <radialGradient id={orbId} cx="50%" cy="52%">
              <stop offset="0%" stopColor="#ff8a3a" stopOpacity="0.42" />
              <stop offset="58%" stopColor="#ff3c00" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#ff3c00" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${idPrefix}-gloop-core`} cx="48%" cy="42%" r="60%">
              <stop offset="0%" stopColor="#fff8d4" />
              <stop offset="55%" stopColor="#ff9d52" />
              <stop offset="100%" stopColor="#d94a1d" stopOpacity="0.88" />
            </radialGradient>
            <linearGradient id={`${idPrefix}-gloop-ray`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,126,56,0)" />
              <stop offset="50%" stopColor="rgba(255,126,56,0.55)" />
              <stop offset="100%" stopColor="rgba(255,126,56,0)" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="52" r="35" fill={`url(#${orbId})`} />
          <line x1="50" y1="4" x2="50" y2="23" stroke={`url(#${idPrefix}-gloop-ray)`} strokeWidth="2.2" opacity="0.65" />
          <line x1="50" y1="80" x2="50" y2="96" stroke={`url(#${idPrefix}-gloop-ray)`} strokeWidth="2.2" opacity="0.58" />
          <line x1="11" y1="52" x2="27" y2="52" stroke={`url(#${idPrefix}-gloop-ray)`} strokeWidth="2.2" opacity="0.56" />
          <line x1="73" y1="52" x2="89" y2="52" stroke={`url(#${idPrefix}-gloop-ray)`} strokeWidth="2.2" opacity="0.56" />
          <path
            d="M26 66 Q18 54 22 42 Q25 28 39 21 Q50 15 61 21 Q75 28 78 42 Q82 54 74 66 Q66 78 50 77 Q34 78 26 66 Z"
            fill={`url(#${shellId})`}
          />
          <ellipse cx="50" cy="52" rx="22.5" ry="21.5" fill={`url(#${idPrefix}-gloop-core)`} opacity="0.78" />
          <path
            d="M26 66 Q18 54 22 42 Q25 28 39 21 Q50 15 61 21 Q75 28 78 42 Q82 54 74 66 Q66 78 50 77 Q34 78 26 66 Z"
            fill="none"
            stroke="#ffd0a1"
            strokeWidth="1.4"
            strokeOpacity="0.44"
          />
          <ellipse cx="50" cy="52" rx="33" ry="31" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.3" />
          <circle cx="35" cy="37" r="3.2" fill="#ffe6c4" fillOpacity="0.32" />
          <circle cx="66" cy="60" r="3.8" fill="#ffe6c4" fillOpacity="0.2" />
          <circle cx="64" cy="40" r="2.2" fill="#ffe6c4" fillOpacity="0.36" />
          <ellipse cx="42.2" cy="49" rx="4.7" ry="5.2" className="character-avatar-eye" fill="#2a0000" />
          <ellipse cx="57.8" cy="49" rx="4.7" ry="5.2" className="character-avatar-eye" fill="#2a0000" />
          <circle cx="43.9" cy="47.2" r="1.45" fill="#fff" />
          <circle cx="59.5" cy="47.2" r="1.45" fill="#fff" />
          <ellipse cx="34" cy="57.5" rx="3.3" ry="2" fill="#ff8585" fillOpacity="0.28" />
          <ellipse cx="66" cy="57.5" rx="3.3" ry="2" fill="#ff8585" fillOpacity="0.28" />
          <path d="M44.8 60.2 Q50 65.2 55.2 60.2" className="character-avatar-mouth" stroke="#3a0000" />
          <path d="M35 36 Q43 27 54 29" stroke="rgba(255,255,255,0.35)" strokeWidth="2.1" fill="none" strokeLinecap="round" />
          <circle cx="26" cy="30" r="1.1" className="character-avatar-star" />
          <circle cx="74" cy="29" r="1.1" className="character-avatar-star" />
          <circle cx="50" cy="18" r="1.3" className="character-avatar-star" />
        </>
      );
    case 'alien-al':
      return (
        <>
          <defs>
            <radialGradient id={orbId} cx="50%" cy="50%">
              <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="52" r="34" fill={`url(#${orbId})`} />
          <ellipse cx="50" cy="52" rx="31" ry="28" fill="#a8d5ba" stroke="#d1fae5" strokeWidth="1.8" />
          <ellipse cx="37" cy="51" rx="8" ry="11.4" className="character-avatar-eye" fill="#2c3e50" transform="rotate(14 37 51)" />
          <ellipse cx="63" cy="51" rx="8" ry="11.4" className="character-avatar-eye" fill="#2c3e50" transform="rotate(-14 63 51)" />
          <circle cx="40" cy="46.5" r="2.1" fill="#fff" opacity="0.9" />
          <circle cx="60" cy="46.5" r="2.1" fill="#fff" opacity="0.9" />
          <circle cx="32" cy="62" r="2.6" fill="#ffb7b2" fillOpacity="0.52" />
          <circle cx="68" cy="62" r="2.6" fill="#ffb7b2" fillOpacity="0.52" />
          <path d="M45.5 64.5 Q50 68.5 54.5 64.5" className="character-avatar-mouth" />
          <line x1="50" y1="24" x2="50" y2="15" stroke="#d1fae5" strokeWidth="1.7" />
          <circle cx="50" cy="13" r="2.3" fill="#fcd34d" />
          <path d="M31 34 Q39 26 47 27" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M35 73 Q50 81 65 73" fill="none" stroke="rgba(44, 62, 80, 0.42)" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="24" cy="30" r="1.05" className="character-avatar-star" />
          <circle cx="76" cy="30" r="1.05" className="character-avatar-star" />
        </>
      );
    case 'black-hole':
      return (
        <>
          <defs>
            <radialGradient id={orbId} cx="50%" cy="50%">
              <stop offset="0%" stopColor="#00d2ff" stopOpacity="0.2" />
              <stop offset="40%" stopColor="#5419e0" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#5419e0" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${idPrefix}-hole-ring`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00d2ff" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#5419e0" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#00d2ff" stopOpacity="0.1" />
            </linearGradient>
            <radialGradient id={shellId} cx="50%" cy="50%">
              <stop offset="0%" stopColor="#000000" />
              <stop offset="68%" stopColor="#070816" />
              <stop offset="100%" stopColor="#121d45" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="52" r="35" fill={`url(#${orbId})`} />
          <ellipse cx="50" cy="52" rx="36" ry="18" fill="none" stroke={`url(#${idPrefix}-hole-ring)`} strokeWidth="2.8" />
          <ellipse cx="50" cy="52" rx="27" ry="11" fill="none" stroke="rgba(84, 25, 224, 0.65)" strokeWidth="1.8" />
          <ellipse cx="50" cy="52" rx="22.8" ry="21.6" fill={`url(#${shellId})`} stroke="#3b1f85" strokeWidth="1.6" />
          <circle cx="50" cy="52" r="13.9" fill="#000000" />
          <ellipse cx="42" cy="50.5" rx="3.8" ry="4.8" fill="#ffffff" />
          <ellipse cx="58" cy="50.5" rx="3.8" ry="4.8" fill="#ffffff" />
          <ellipse cx="42" cy="50.5" rx="1.5" ry="2.1" className="character-avatar-eye" fill="#0f172a" />
          <ellipse cx="58" cy="50.5" rx="1.5" ry="2.1" className="character-avatar-eye" fill="#0f172a" />
          <path d="M46 59 Q50 62.8 54 59" className="character-avatar-mouth" stroke="#ffffff" />
          <circle cx="26" cy="32" r="1.1" className="character-avatar-star" />
          <circle cx="74" cy="31" r="1.1" className="character-avatar-star" />
          <circle cx="31" cy="68" r="1" fill="#00d2ff" opacity="0.9" />
          <circle cx="69" cy="68" r="1" fill="#5419e0" opacity="0.9" />
        </>
      );
    case 'astro-bot':
      return (
        <>
          <defs>
            <radialGradient id={haloId} cx="50%" cy="26%">
              <stop offset="0%" stopColor="#0f172a" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="46" r="30" fill="none" stroke="#f8fafc" strokeWidth="8" />
          <circle cx="50" cy="46" r="24" fill={`url(#${haloId})`} />
          <circle cx="41" cy="45" r="5.2" fill="#f8fafc" />
          <circle cx="59" cy="45" r="5.2" fill="#f8fafc" />
          <circle cx="41" cy="45" r="2.2" className="character-avatar-eye" fill="#111827" />
          <circle cx="59" cy="45" r="2.2" className="character-avatar-eye" fill="#111827" />
          <path d="M44 56 Q50 62 56 56" className="character-avatar-mouth" stroke="#f472b6" />
          <rect x="37" y="66" width="26" height="20" rx="8" fill="#f8fafc" />
          <rect x="43" y="73" width="3.5" height="8" rx="2" fill="#60a5fa" />
          <rect x="47.5" y="73" width="3.5" height="8" rx="2" fill="#f472b6" />
          <rect x="52" y="73" width="3.5" height="8" rx="2" fill="#fbbf24" />
          <circle cx="25" cy="31" r="1.2" className="character-avatar-star" />
          <circle cx="75" cy="30" r="1.2" className="character-avatar-star" />
          <circle cx="50" cy="13" r="1.4" className="character-avatar-star" />
          <ellipse cx="42" cy="90" rx="7" ry="3" className="character-avatar-foot" />
          <ellipse cx="58" cy="90" rx="7" ry="3" className="character-avatar-foot" />
        </>
      );
    case 'jelly-jet':
      return (
        <>
          <defs>
            <linearGradient id={orbId} x1="50%" y1="14%" x2="50%" y2="82%">
              <stop offset="0%" stopColor="#c4b5fd" />
              <stop offset="55%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#6d28d9" />
            </linearGradient>
            <linearGradient id={`${idPrefix}-jelly-tentacle`} x1="50%" y1="50%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#6d28d9" stopOpacity="0.5" />
            </linearGradient>
            <radialGradient id={`${idPrefix}-jelly-gleam`} cx="50%" cy="24%" r="56%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="26" cy="34" r="1.2" className="character-avatar-star" />
          <circle cx="74" cy="33" r="1.2" className="character-avatar-star" />
          <circle cx="82" cy="48" r="1.1" className="character-avatar-star" />
          <circle cx="18" cy="50" r="1.1" className="character-avatar-star" />
          <polygon points="50,18 51.5,21.8 55.6,21.8 52.4,24.3 53.7,28.2 50,26 46.3,28.2 47.6,24.3 44.4,21.8 48.5,21.8" className="character-avatar-star" />
          <g className="jelly-tentacles-back">
            <path
              className="jelly-tentacle jelly-tentacle-3"
              d="M35 63 C35 76, 28 84, 34 95"
              stroke={`url(#${idPrefix}-jelly-tentacle)`}
              strokeWidth="4.9"
              strokeLinecap="round"
              fill="none"
              opacity="0.8"
            />
            <path
              className="jelly-tentacle jelly-tentacle-4"
              d="M65 63 C65 76, 72 84, 66 95"
              stroke={`url(#${idPrefix}-jelly-tentacle)`}
              strokeWidth="4.9"
              strokeLinecap="round"
              fill="none"
              opacity="0.8"
            />
          </g>
          <g className="jelly-tentacles-front">
            <path
              className="jelly-tentacle jelly-tentacle-1"
              d="M42 64 C42 80, 37 88, 44 97"
              stroke={`url(#${idPrefix}-jelly-tentacle)`}
              strokeWidth="5.5"
              strokeLinecap="round"
              fill="none"
            />
            <path
              className="jelly-tentacle jelly-tentacle-2"
              d="M58 64 C58 80, 63 88, 56 97"
              stroke={`url(#${idPrefix}-jelly-tentacle)`}
              strokeWidth="5.5"
              strokeLinecap="round"
              fill="none"
            />
            <path
              className="jelly-tentacle jelly-tentacle-5"
              d="M50 64 C50 81, 53 90, 50 100"
              stroke={`url(#${idPrefix}-jelly-tentacle)`}
              strokeWidth="5.2"
              strokeLinecap="round"
              fill="none"
            />
          </g>
          <path d="M24 62 L24 55 C24 42 35 30 50 30 C65 30 76 42 76 55 L76 62 Q69 68 63 62 Q56 68 50 62 Q44 68 37 62 Q31 68 24 62 Z" fill={`url(#${orbId})`} />
          <path d="M24 62 Q31 68 37 62 Q44 68 50 62 Q56 68 63 62 Q69 68 76 62" fill="#7c3aed" opacity="0.34" />
          <ellipse cx="50" cy="49" rx="24" ry="17" fill={`url(#${idPrefix}-jelly-gleam)`} />
          <circle cx="41" cy="49.5" r="7" className="character-avatar-eye" fill="#ffffff" />
          <circle cx="59" cy="49.5" r="7" className="character-avatar-eye" fill="#ffffff" />
          <circle cx="42.6" cy="49.8" r="2.2" fill="#312e81" />
          <circle cx="57.4" cy="49.8" r="2.2" fill="#312e81" />
          <circle cx="35.6" cy="56" r="2.3" fill="#f472b6" opacity="0.5" />
          <circle cx="64.4" cy="56" r="2.3" fill="#f472b6" opacity="0.5" />
          <path d="M45.5 58.7 Q50 62.5 54.5 58.7" className="character-avatar-mouth" />
          <circle cx="32" cy="40" r="1.7" fill="#e9d5ff" opacity="0.92" />
          <circle cx="68" cy="40.5" r="1.7" fill="#e9d5ff" opacity="0.92" />
        </>
      );
    case 'cosmo-cat':
      return (
        <>
          <polygon points="28,28 36,12 43,30" fill="#f59e0b" />
          <polygon points="72,28 64,12 57,30" fill="#f59e0b" />
          <circle cx="50" cy="52" r="30" fill="#fdba74" />
          <ellipse cx="38" cy="52" rx="8.3" ry="8.8" className="character-avatar-eye" fill="#7c2d12" />
          <ellipse cx="62" cy="52" rx="8.3" ry="8.8" className="character-avatar-eye" fill="#7c2d12" />
          <circle cx="40" cy="49" r="2" fill="#fff" />
          <circle cx="64" cy="49" r="2" fill="#fff" />
          <polygon points="50,33 52,37.8 57,37.8 53,41 54.5,46 50,43.1 45.5,46 47,41 43,37.8 48,37.8" fill="#fef08a" className="character-avatar-star" />
          <path d="M45 64 Q50 69 55 64" className="character-avatar-mouth" />
          <path d="M31 61 H40 M60 61 H69" stroke="#b45309" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="27" cy="35" r="1.1" className="character-avatar-star" />
          <circle cx="73" cy="35" r="1.1" className="character-avatar-star" />
          <ellipse cx="42" cy="90" rx="7" ry="3" className="character-avatar-foot" />
          <ellipse cx="58" cy="90" rx="7" ry="3" className="character-avatar-foot" />
        </>
      );
    case 'animal-cat':
    case 'astro-classic':
    case 'astro-round':
    case 'astro-goofy':
    case 'astro-star':
    case 'animal-octo':
    case 'animal-panda':
    case 'animal-fox':
    default:
      return (
        <>
          <circle cx="50" cy="52" r="30" fill="#e2e8f0" />
          <circle cx="40" cy="52" r="8" className="character-avatar-eye" fill="#0f172a" />
          <circle cx="60" cy="52" r="8" className="character-avatar-eye" fill="#0f172a" />
          <circle cx="42" cy="50" r="2" fill="#fff" />
          <circle cx="62" cy="50" r="2" fill="#fff" />
          <path d="M45 64 Q50 69 55 64" className="character-avatar-mouth" />
          <ellipse cx="41" cy="90" rx="7" ry="3" className="character-avatar-foot" />
          <ellipse cx="59" cy="90" rx="7" ry="3" className="character-avatar-foot" />
        </>
      );
  }
};

const CharacterAvatar = ({ characterId, size = 'md' }: { characterId?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) => {
  const character = getCharacterById(characterId);
  const variant = characterVariantById[character?.id ?? ''] ?? 'astro-bot';
  const idPrefix = useId().replace(/:/g, '');
  const palette = characterPaletteById[character?.id ?? ''] ?? {
    base: '#93C5FD',
    accent: '#3B82F6',
    trim: '#E2E8F0',
    mark: '#0F172A'
  };

  const style = {
    '--char-base': palette.base,
    '--char-accent': palette.accent,
    '--char-trim': palette.trim,
    '--char-mark': palette.mark
  } as CSSProperties;

  return (
    <span className={`character-avatar ${character?.kind ?? 'astronaut'} ${variant} size-${size}`} style={style} aria-hidden="true">
      <svg className="character-avatar-svg" viewBox="0 0 100 100" role="presentation">
        <g className={`character-sprite ${variant}`}>{renderCharacterSprite(variant, idPrefix)}</g>
      </svg>
    </span>
  );
};

const BrandMark = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => (
  <span className={`brand-mark size-${size}`} aria-hidden="true">
    <span className="brand-mark-planet" />
    <span className="brand-mark-ring" />
    <span className="brand-mark-moon" />
  </span>
);

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [brandVariant] = useState<BrandVariant>('simplified');
  const [screen, setScreen] = useState<Screen>(() => {
    const bootState = loadState();
    if (typeof window !== 'undefined') {
      const hasSeenLanding = window.localStorage.getItem(LANDING_SEEN_STORAGE_KEY) === '1';
      if (!hasSeenLanding) return 'landing';
    }
    return bootState.user ? 'home' : 'onboarding';
  });
  const [run, setRun] = useState<RunState>(newRun('galaxy_mix'));
  const [selectedMode, setSelectedMode] = useState<GameMode>('galaxy_mix');
  const [input, setInput] = useState('');
  const [scratchpad, setScratchpad] = useState('');
  const [scratchpadExpanded, setScratchpadExpanded] = useState(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 700px)').matches : true
  );
  const [feedback, setFeedback] = useState('');
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info');
  const [resultPulse, setResultPulse] = useState<FeedbackTone | null>(null);
  const [resultFlash, setResultFlash] = useState<{ tone: FeedbackTone; title: string; detail: string; icon: string } | null>(null);
  const resultFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clarifyInput, setClarifyInput] = useState('');
  const [clarifyReply, setClarifyReply] = useState('');
  const scratchpadRef = useRef<HTMLTextAreaElement | null>(null);
  const [showTutor, setShowTutor] = useState(false);
  const [showClarifyDialog, setShowClarifyDialog] = useState(false);
  const [tutorStep, setTutorStep] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 700px)').matches : false
  );
  const [isTextEntryFocused, setIsTextEntryFocused] = useState(false);
  const [homeNavRevealed, setHomeNavRevealed] = useState(false);
  const appContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef(0);
  const lastSubmittedStatsRef = useRef('');
  const [nameInput, setNameInput] = useState(() => loadState().user?.username ?? '');
  const [selectedCharacterId, setSelectedCharacterId] = useState(() => {
    const saved = loadState().user?.avatarId;
    if (saved) return getCharacterById(saved)?.id ?? defaultCharacterId;
    return '';
  });
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>('all_time');
  const [leaderboardStatus, setLeaderboardStatus] = useState<'online' | 'offline'>('offline');
  const [networkLeaderboardRows, setNetworkLeaderboardRows] = useState<LeaderboardRow[] | null>(null);
  const [isRegisteringPlayer, setIsRegisteringPlayer] = useState(false);
  const [showAttemptedPuzzles, setShowAttemptedPuzzles] = useState(false);
  const [expandedMuseumPuzzleId, setExpandedMuseumPuzzleId] = useState<string | null>(null);
  const [pendingBonusFinish, setPendingBonusFinish] = useState<PendingBonusFinish | null>(null);
  const [bonusResult, setBonusResult] = useState<{ correct: boolean; answer: string } | null>(null);
  const [celebratingCharacterId, setCelebratingCharacterId] = useState<string | null>(null);
  const celebrateCharacterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [onboardingStage, setOnboardingStage] = useState<'name' | 'character'>(() => (loadState().user ? 'character' : 'name'));
  const scratchpadFieldId = useId();
  const scratchpadPlaceholder = 'You can work through the problem here. This will not be used for scoring.';
  const explorerLevel = Math.floor(state.totals.allTimeStars / 250) + 1;
  const selectedCharacter = getCharacterById(selectedCharacterId);
  const isEditingProfile = Boolean(state.user);
  const onboardingCadetName = nameInput.trim() || 'Cadet';
  const homeCadetName = state.user?.username ?? onboardingCadetName;
  const homeCharacterId = selectedCharacter?.id ?? state.user?.avatarId ?? defaultCharacterId;
  const avgSessionPoints = state.totals.runsPlayed ? Math.round(state.totals.allTimeStars / state.totals.runsPlayed) : 0;
  const todayWeekday = new Date().getDay();
  const todayBarIndex = (todayWeekday + 6) % 7;

  const totalScore = run.sprintScore + run.brainScore;
  const topBarPoints = screen === 'run' || screen === 'summary' ? totalScore : state.totals.allTimeStars;
  const runTargetTotal = run.flowTarget + run.puzzleTarget;
  const runDoneTotal = run.flowDone + run.puzzleDone;
  const flowProgress = runTargetTotal ? Math.round((runDoneTotal / runTargetTotal) * 100) : 0;
  const canJoinGlobalLeaderboard = state.totals.allTimeStars >= GLOBAL_LEADERBOARD_MIN_STARS;
  const puzzleSolveRate = state.totals.allTimePuzzleTries
    ? Math.max(
        0,
        Math.min(100, Math.round((state.totals.allTimePuzzleCorrect / state.totals.allTimePuzzleTries) * 100))
      )
    : 0;
  const hasCadetSnapshot = state.totals.allTimeStars > 0 || state.streaks.dailyStreak > 0 || state.streaks.puzzleStreak > 0;
  const getNewPlayerFlowDifficultyCap = (attemptsCount: number) =>
    state.totals.runsPlayed === 0 && attemptsCount < NEW_PLAYER_ONRAMP_ATTEMPTS
      ? NEW_PLAYER_FLOW_MAX_DIFFICULTY
      : undefined;
  const activityBars = useMemo(() => {
    const bars = ACTIVITY_DAY_LABELS.map((label, index) => ({
      label,
      isToday: index === todayBarIndex,
      height: 12
    }));

    if (state.totals.runsPlayed <= 0) return bars;

    const streakDays = Math.min(7, Math.max(0, state.streaks.dailyStreak));
    const paceBoost = Math.min(18, Math.round(avgSessionPoints / 28));

    if (streakDays === 0) {
      bars[todayBarIndex].height = clamp(32 + paceBoost, 22, 76);
      return bars;
    }

    for (let offset = 0; offset < streakDays; offset += 1) {
      const dayIndex = (todayBarIndex - offset + 7) % 7;
      const intensity = Math.max(0, streakDays - offset - 1);
      bars[dayIndex].height = clamp(44 + intensity * 7 + paceBoost, 30, 92);
    }

    const baselineLift = Math.min(14, Math.round(state.totals.runsPlayed / 2));
    return bars.map((bar) => (bar.height > 12 ? bar : { ...bar, height: clamp(12 + baselineLift, 12, 30) }));
  }, [avgSessionPoints, state.streaks.dailyStreak, state.totals.runsPlayed, todayBarIndex]);

  const save = (next: AppState) => {
    setState(next);
    saveState(next);
  };

  const resetScrollToTop = () => {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const container = appContainerRef.current;
    if (container) container.scrollTop = 0;
  };

  const resetInputAndFeedback = () => {
    setInput('');
    setScratchpad('');
    setClarifyInput('');
    setClarifyReply('');
    setShowTutor(false);
    setShowClarifyDialog(false);
    setTutorStep(0);
    setFeedback('');
    setFeedbackTone('info');
    setResultPulse(null);
    setResultFlash(null);
    if (resultFlashTimeoutRef.current) {
      clearTimeout(resultFlashTimeoutRef.current);
      resultFlashTimeoutRef.current = null;
    }
  };

  const autoResizeScratchpad = (target: HTMLTextAreaElement | null) => {
    if (!target) return;
    target.style.height = '0px';
    target.style.height = `${Math.max(target.scrollHeight, 96)}px`;
  };

  const onScratchpadChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setScratchpad(event.target.value);
    autoResizeScratchpad(event.target);
  };

  const triggerPulse = (tone: FeedbackTone) => {
    setResultPulse(tone);
    setTimeout(() => setResultPulse(null), 420);
  };

  const triggerResultFlash = (tone: FeedbackTone, title: string, detail: string) => {
    if (resultFlashTimeoutRef.current) {
      clearTimeout(resultFlashTimeoutRef.current);
      resultFlashTimeoutRef.current = null;
    }

    const icon = tone === 'success' ? '🎉' : tone === 'error' ? '💫' : '🚀';
    setResultFlash({ tone, title, detail, icon });
    resultFlashTimeoutRef.current = setTimeout(() => {
      setResultFlash(null);
      resultFlashTimeoutRef.current = null;
    }, 1750);
  };

  useEffect(() => {
    return () => {
      if (resultFlashTimeoutRef.current) clearTimeout(resultFlashTimeoutRef.current);
      if (celebrateCharacterTimeoutRef.current) clearTimeout(celebrateCharacterTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 700px)');
    const onChange = () => setIsMobileViewport(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useLayoutEffect(() => {
    autoResizeScratchpad(scratchpadRef.current);
  }, [scratchpad, scratchpadExpanded, run.phase, run.currentFlow?.id, run.currentPuzzle?.id, run.bossStage, run.bonusChallenge?.id]);

  useEffect(() => {
    if (screen !== 'run') {
      setScratchpad('');
      return;
    }

    if (run.phase === 'flow' && run.currentFlow?.id) {
      setScratchpad('');
      return;
    }

    if (run.phase === 'puzzle' && run.currentPuzzle?.id) {
      setScratchpad('');
      return;
    }

    if (run.phase === 'boss' && run.bossStage === 'question') {
      setScratchpad('');
    }
  }, [screen, run.phase, run.currentFlow?.id, run.currentPuzzle?.id, run.bossStage, run.bonusChallenge?.id]);

  useEffect(() => {
    if (screen !== 'run') {
      setScratchpadExpanded(true);
      return;
    }
    setScratchpadExpanded(!isMobileViewport);
  }, [screen, isMobileViewport, run.phase, run.currentFlow?.id, run.currentPuzzle?.id, run.bossStage, run.bonusChallenge?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const getScrollY = () => Math.max(window.scrollY, appContainerRef.current?.scrollTop ?? 0);
    const handleScroll = () => {
      const y = getScrollY();
      const delta = y - lastScrollYRef.current;
      const minDelta = 6;

      if (y <= 8) {
        setHomeNavRevealed(false);
      } else if (delta > minDelta) {
        setHomeNavRevealed(true);
      } else if (delta < -minDelta) {
        setHomeNavRevealed(false);
      }

      lastScrollYRef.current = y;
    };
    lastScrollYRef.current = getScrollY();
    setHomeNavRevealed(false);
    window.addEventListener('scroll', handleScroll, { passive: true });
    const container = appContainerRef.current;
    container?.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      container?.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const y = Math.max(typeof window !== 'undefined' ? window.scrollY : 0, appContainerRef.current?.scrollTop ?? 0);
    lastScrollYRef.current = y;
    setHomeNavRevealed(false);
  }, [screen]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const isTypingField = (node: EventTarget | null) => {
      if (!(node instanceof HTMLElement)) return false;
      const tag = node.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
    };

    const syncFocusState = () => {
      const active = document.activeElement;
      setIsTextEntryFocused(isTypingField(active));
    };

    const onFocusIn = (event: FocusEvent) => {
      setIsTextEntryFocused(isTypingField(event.target));
    };
    const onFocusOut = () => {
      // Wait one tick so focus can move to the next field first.
      window.setTimeout(syncFocusState, 0);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    syncFocusState();
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useLayoutEffect(() => {
    resetScrollToTop();
    const rafId = window.requestAnimationFrame(() => resetScrollToTop());
    return () => window.cancelAnimationFrame(rafId);
  }, [screen]);

  useEffect(() => {
    if (screen !== 'scores') return;
    let active = true;
    const loadLeaderboardRows = async () => {
      try {
        const rows = await fetchLeaderboard(leaderboardMode, 50);
        if (!active) return;
        setNetworkLeaderboardRows(rows);
        setLeaderboardStatus('online');
      } catch {
        if (!active) return;
        setNetworkLeaderboardRows(null);
        setLeaderboardStatus('offline');
        // Keep app usable with local rivals when backend is unavailable.
      }
    };
    loadLeaderboardRows();
    return () => {
      active = false;
    };
  }, [screen, leaderboardMode, state.user?.userId, state.totals]);

  useEffect(() => {
    lastSubmittedStatsRef.current = '';
  }, [state.user?.userId]);

  useEffect(() => {
    if (!state.user?.userId || !canJoinGlobalLeaderboard) return;
    const payload = {
      allTimeStars: state.totals.allTimeStars,
      bestRunStars: state.totals.bestRunStars,
      trophiesEarned: state.totals.trophiesEarned,
      extensionsSolved: state.totals.extensionsSolved
    };
    const submissionKey = `${payload.allTimeStars}|${payload.bestRunStars}|${payload.trophiesEarned}|${payload.extensionsSolved}`;
    if (submissionKey === lastSubmittedStatsRef.current) return;

    let cancelled = false;
    const syncScore = async () => {
      try {
        await upsertScore({
          userId: state.user!.userId!,
          username: state.user!.username,
          avatarId: state.user!.avatarId,
          ...payload
        });
        if (cancelled) return;
        setLeaderboardStatus('online');
        lastSubmittedStatsRef.current = submissionKey;
      } catch {
        if (!cancelled) setLeaderboardStatus('offline');
        // Best-effort sync; app still works offline.
      }
    };

    syncScore();
    return () => {
      cancelled = true;
    };
  }, [canJoinGlobalLeaderboard, leaderboardMode, state.totals, state.user]);

  const getPuzzleChoices = (rating: number, usedPuzzleIds: Set<string>) =>
    generateAdaptivePuzzleChoices(rating, usedPuzzleIds, 2);

  const finishRun = (bossAttempted: boolean, runSnapshot: RunState = run, baseState: AppState = state) => {
    const sprint = runSnapshot.sprintScore;
    const baseBrain = runSnapshot.brainScore;
    const bonusDelta = bossAttempted ? baseBrain : 0;
    const brain = baseBrain + bonusDelta;
    const total = sprint + brain;
    const finalRunStars = runSnapshot.starsThisRound + Math.max(0, bonusDelta);

    const highs = {
      bestTotal: Math.max(baseState.highs.bestTotal, total),
      bestSprint: Math.max(baseState.highs.bestSprint, sprint),
      bestBrain: Math.max(baseState.highs.bestBrain, brain)
    };

    const totals = completeRunTotals(baseState.totals, runSnapshot.starsThisRound, bonusDelta);

    save({ ...baseState, highs, totals });
    setRun({ ...runSnapshot, sprintScore: sprint, brainScore: brain, starsThisRound: finalRunStars });
    setPendingBonusFinish(null);
    setBonusResult(null);
    setFeedback(bossAttempted ? 'Bonus round played. Final score updated!' : 'Game complete. Great work!');
    setFeedbackTone('info');
    triggerPulse('info');
    setScreen('summary');
  };

  const startRun = (mode: GameMode = selectedMode) => {
    const streaks = updateDailyStreak(state.streaks);
    const seeded = newRun(mode);
    if (seeded.flowTarget > 0) {
      seeded.currentFlow = generateAdaptiveFlowItem(
        state.skill.rating,
        seeded.usedFlowIds,
        undefined,
        seeded.recentTemplates,
        seeded.recentShapes,
        seeded.recentPatternTags,
        seeded.flowStreak,
        getNewPlayerFlowDifficultyCap(state.skill.attemptsCount)
      );
    }
    else seeded.currentPuzzleChoices = getPuzzleChoices(state.skill.rating, seeded.usedPuzzleIds);

    setPendingBonusFinish(null);
    setBonusResult(null);
    setRun(seeded);
    save({ ...state, streaks });
    setScreen('run');
    resetInputAndFeedback();
  };

  const setupPuzzlePick = () => {
    const choices = getPuzzleChoices(state.skill.rating, run.usedPuzzleIds);
    setRun({ ...run, phase: 'puzzle_pick', currentPuzzleChoices: choices, currentHints: 0, currentPuzzle: undefined });
    setInput('');
    setClarifyInput('');
    setClarifyReply('');
    setShowTutor(false);
    setShowClarifyDialog(false);
    setTutorStep(0);
    setFeedback('Pick a puzzle card to keep going.');
    setFeedbackTone('info');
  };

  const selectPuzzle = (puzzle: PuzzleItem) => {
    setRun({ ...run, phase: 'puzzle', currentPuzzle: puzzle, currentHints: 0 });
    setInput('');
    setClarifyInput('');
    setClarifyReply('');
    setShowTutor(false);
    setShowClarifyDialog(false);
    setTutorStep(0);
    setFeedback('You got this. Let’s solve it!');
    setFeedbackTone('info');
  };

  const onSubmitFlow = () => {
    if (!run.currentFlow || !input.trim()) return;

    const item = run.currentFlow;
    const answers = [item.answer, ...(item.accept_answers ?? [])];
    const correct = isSmartAnswerMatch(input, answers);

    const nextStreak = correct ? Math.min(run.flowStreak + 1, 8) : 0;
    const updatedRating = updateRating(state.skill.rating, item.difficulty, correct, state.skill.attemptsCount, nextStreak);
    const tier = getTier(item.difficulty, item.tier);
    const hintPenalty = run.currentHints * 3;
    const gain = correct ? Math.max(tier.flowPoints - hintPenalty, 4) : 0;
    const nextTotals = applyStarAward(state.totals, gain);
    const nextState: AppState = {
      ...state,
      skill: { rating: updatedRating, attemptsCount: state.skill.attemptsCount + 1 },
      totals: nextTotals
    };

    const usedFlowIds = new Set(run.usedFlowIds);
    usedFlowIds.add(item.id);
    const recentTemplates = [...run.recentTemplates, item.template].slice(-6);
    const recentShapes = [...run.recentShapes, item.shapeSignature].slice(-6);
    const currentPatternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
    const recentPatternTags = [...run.recentPatternTags, ...currentPatternTags].slice(-6);
    const nextFlowDone = run.flowDone + 1;
    const nextRunDifficultySamples = [...run.runDifficultySamples, item.difficulty];

    if (nextFlowDone >= run.flowTarget) {
      if (run.puzzleTarget === 0) {
        save(nextState);
        setRun({
          ...run,
          flowDone: nextFlowDone,
          sprintScore: run.sprintScore + gain,
          usedFlowIds,
          recentTemplates,
          recentShapes,
          recentPatternTags,
          flowStreak: nextStreak,
          phase: 'boss',
          bossStage: 'intro',
          runDifficultySamples: nextRunDifficultySamples,
          bonusChallenge: createBonusChallenge(run.gameMode, 'flow', updatedRating, nextRunDifficultySamples),
          currentHints: 0,
          currentFlow: undefined,
          starsThisRound: run.starsThisRound + gain
        });
        setFeedback(correct ? `Great work! +${gain} score` : `Almost! Correct answer: ${item.answer}`);
        setFeedbackTone(correct ? 'success' : 'error');
        triggerPulse(correct ? 'success' : 'error');
        triggerResultFlash(
          correct ? 'success' : 'error',
          'Bonus unlocked!',
          correct ? `+${gain} points` : `Answer: ${item.answer}`
        );
        setInput('');
        setShowTutor(false);
        setShowClarifyDialog(false);
        setTutorStep(0);
        return;
      }

      save(nextState);
      setRun({
        ...run,
        flowDone: nextFlowDone,
        sprintScore: run.sprintScore + gain,
        usedFlowIds,
        phase: 'puzzle_pick',
        currentPuzzleChoices: getPuzzleChoices(updatedRating, run.usedPuzzleIds),
        currentPuzzle: undefined,
        recentTemplates,
        recentShapes,
        recentPatternTags,
        flowStreak: nextStreak,
        runDifficultySamples: nextRunDifficultySamples,
        currentHints: 0,
        starsThisRound: run.starsThisRound + gain
      });
      setFeedback(correct ? 'Awesome! Quick questions complete. Pick your first puzzle.' : `Nice try. ${item.solution_steps[0]}`);
      setFeedbackTone(correct ? 'success' : 'error');
      triggerPulse(correct ? 'success' : 'error');
      triggerResultFlash(
        correct ? 'success' : 'error',
        correct ? 'Nice work!' : 'Almost there',
        correct ? `+${gain} points` : `Answer: ${item.answer}`
      );
      setInput('');
      setShowTutor(false);
      setShowClarifyDialog(false);
      setTutorStep(0);
      return;
    }

    save(nextState);
    const nextItem = generateAdaptiveFlowItem(
      updatedRating,
      usedFlowIds,
      item.difficulty,
      recentTemplates,
      recentShapes,
      recentPatternTags,
      nextStreak,
      getNewPlayerFlowDifficultyCap(state.skill.attemptsCount + 1)
    );
    setRun({
      ...run,
      flowDone: nextFlowDone,
      sprintScore: run.sprintScore + gain,
      usedFlowIds,
      recentTemplates,
      recentShapes,
      recentPatternTags,
      currentFlow: nextItem,
      flowStreak: nextStreak,
      runDifficultySamples: nextRunDifficultySamples,
      currentHints: 0,
      starsThisRound: run.starsThisRound + gain
    });

    setFeedback(correct ? `Great work! +${gain} score` : `Almost! Correct answer: ${item.answer}`);
    setFeedbackTone(correct ? 'success' : 'error');
    triggerPulse(correct ? 'success' : 'error');
    triggerResultFlash(
      correct ? 'success' : 'error',
      correct ? 'Great job!' : 'Keep going!',
      correct ? `+${gain} points` : `Answer: ${item.answer}`
    );
    setInput('');
    setShowTutor(false);
    setShowClarifyDialog(false);
    setTutorStep(0);
  };

  const submitPuzzle = () => {
    if (!run.currentPuzzle || !input.trim()) return;

    const correct = isPuzzleAnswerCorrect(run.currentPuzzle, input);
    const tier = getTier(run.currentPuzzle.difficulty);
    const revealUsed = run.currentHints >= MAX_PUZZLE_HINTS;
    const hintPenalty = run.currentHints === 0 ? 0 : run.currentHints === 1 ? 8 : 16;
    const gain = correct ? Math.max(tier.puzzlePoints - hintPenalty, 10) : 0;
    const updatedRating = updateRating(state.skill.rating, run.currentPuzzle.difficulty, correct, state.skill.attemptsCount);

    const usedPuzzleIds = new Set(run.usedPuzzleIds);
    usedPuzzleIds.add(run.currentPuzzle.id);
    const puzzleDone = run.puzzleDone + 1;
    const nextRunDifficultySamples = [...run.runDifficultySamples, run.currentPuzzle.difficulty];

    const streaks = updatePuzzleStreak(state.streaks, correct && !revealUsed);
    const museum = [...state.museum];
    const idx = museum.findIndex((entry) => entry.puzzleId === run.currentPuzzle?.id);
    const previousEntry = idx >= 0 ? museum[idx] : undefined;
    const solved = Boolean(previousEntry?.solved) || correct;
    const extensionGain = correct ? (run.currentHints <= 1 ? 1 : 0) : 0;
    const entry = {
      puzzleId: run.currentPuzzle.id,
      title: run.currentPuzzle.title,
      promptSnapshot: run.currentPuzzle.core_prompt,
      hintsSnapshot: run.currentPuzzle.hint_ladder.slice(0, 3),
      solved,
      attempts: (previousEntry?.attempts ?? 0) + 1,
      extensionsCompleted: Math.max(previousEntry?.extensionsCompleted ?? 0, extensionGain),
      methodsFound: solved ? ['core-solved'] : []
    };

    if (idx >= 0) museum[idx] = { ...museum[idx], ...entry };
    else museum.push(entry);

    const solvedPuzzleIds = upsertSolvedPuzzleIds(state.solvedPuzzleIds, run.currentPuzzle.id, solved);

    const totals = recalcTotals(
      {
        ...applyStarAward(state.totals, gain),
        allTimePuzzleCorrect: state.totals.allTimePuzzleCorrect + (correct ? 1 : 0),
        allTimePuzzleTries: state.totals.allTimePuzzleTries + 1
      },
      solvedPuzzleIds,
      museum
    );
    const nextState: AppState = {
      ...state,
      streaks,
      museum,
      solvedPuzzleIds,
      totals,
      skill: { rating: updatedRating, attemptsCount: state.skill.attemptsCount + 1 }
    };

    if (puzzleDone >= run.puzzleTarget) {
      save(nextState);
      setRun({
        ...run,
        brainScore: run.brainScore + gain,
        puzzleDone,
        usedPuzzleIds,
        starsThisRound: run.starsThisRound + gain,
        puzzlesSolvedThisRound: run.puzzlesSolvedThisRound + (correct ? 1 : 0),
        puzzlesTriedThisRound: run.puzzlesTriedThisRound + 1,
        phase: 'boss',
        bossStage: 'intro',
        runDifficultySamples: nextRunDifficultySamples,
        bonusChallenge: createBonusChallenge(run.gameMode, 'puzzle', updatedRating, nextRunDifficultySamples),
        currentHints: 0,
        currentPuzzle: undefined,
        currentPuzzleChoices: []
      });
      setFeedback(correct ? `Nice solve! +${gain} score` : `Not yet. Correct answer: ${run.currentPuzzle.core_answer}`);
      setFeedbackTone(correct ? 'success' : 'error');
      triggerPulse(correct ? 'success' : 'error');
      triggerResultFlash(
        correct ? 'success' : 'error',
        correct ? 'Puzzle solved!' : 'Almost there',
        correct ? `+${gain} points` : `Answer: ${run.currentPuzzle.core_answer}`
      );
      setInput('');
      setClarifyInput('');
      setClarifyReply('');
      setShowTutor(false);
      setShowClarifyDialog(false);
      setTutorStep(0);
      return;
    }

    save(nextState);
    setRun({
      ...run,
      brainScore: run.brainScore + gain,
      puzzleDone,
      usedPuzzleIds,
      starsThisRound: run.starsThisRound + gain,
      puzzlesSolvedThisRound: run.puzzlesSolvedThisRound + (correct ? 1 : 0),
      puzzlesTriedThisRound: run.puzzlesTriedThisRound + 1,
      runDifficultySamples: nextRunDifficultySamples,
      phase: 'puzzle_pick',
      currentHints: 0,
      currentPuzzle: undefined,
      currentPuzzleChoices: getPuzzleChoices(updatedRating, usedPuzzleIds)
    });

    setFeedback(correct ? `Nice solve! +${gain} score` : `Not yet. Correct answer: ${run.currentPuzzle.core_answer}`);
    setFeedbackTone(correct ? 'success' : 'error');
    triggerPulse(correct ? 'success' : 'error');
    triggerResultFlash(
      correct ? 'success' : 'error',
      correct ? 'Puzzle solved!' : 'Try another one',
      correct ? `+${gain} points` : `Answer: ${run.currentPuzzle.core_answer}`
    );
    setInput('');
    setClarifyInput('');
    setClarifyReply('');
    setShowTutor(false);
    setShowClarifyDialog(false);
    setTutorStep(0);
  };

  const startBonusRound = () => {
    setRun({ ...run, bossStage: 'question' as const, currentHints: 0 });
    setInput('');
    setShowTutor(false);
    setTutorStep(0);
    setFeedback('Mini Boss unlocked. Solve it to double your puzzle points!');
    setFeedbackTone('info');
  };

  const submitBonusRound = () => {
    if (!input.trim()) return;
    const challenge = run.bonusChallenge ?? fallbackBonusChallenge;
    const correct = isSmartAnswerMatch(input, [challenge.answer, ...(challenge.acceptAnswers ?? [])]);
    const bonusPuzzleId = challenge.id.startsWith('bonus-') ? challenge.id.slice('bonus-'.length) : challenge.id;

    const museum = [...state.museum];
    const idx = museum.findIndex((entry) => entry.puzzleId === bonusPuzzleId);
    const previousEntry = idx >= 0 ? museum[idx] : undefined;
    const solved = Boolean(previousEntry?.solved) || correct;
    const bonusEntry = {
      puzzleId: bonusPuzzleId,
      title: challenge.title,
      promptSnapshot: challenge.prompt,
      hintsSnapshot: challenge.hintLadder.slice(0, 3),
      solved,
      attempts: (previousEntry?.attempts ?? 0) + 1,
      extensionsCompleted: Math.max(previousEntry?.extensionsCompleted ?? 0, correct ? 1 : 0),
      methodsFound: solved ? ['core-solved', 'bonus-solved'] : previousEntry?.methodsFound ?? []
    };

    if (idx >= 0) museum[idx] = { ...museum[idx], ...bonusEntry };
    else museum.push(bonusEntry);

    const solvedPuzzleIds = upsertSolvedPuzzleIds(state.solvedPuzzleIds, bonusPuzzleId, solved);
    const totals = recalcTotals(
      {
        ...state.totals,
        allTimePuzzleCorrect: state.totals.allTimePuzzleCorrect + (correct ? 1 : 0),
        allTimePuzzleTries: state.totals.allTimePuzzleTries + 1
      },
      solvedPuzzleIds,
      museum
    );
    const baseState: AppState = {
      ...state,
      museum,
      solvedPuzzleIds,
      totals
    };

    const snapshot: RunState = { ...run, bossStage: 'result', currentHints: 0 };
    setRun(snapshot);
    setPendingBonusFinish({ bossAttempted: correct, runSnapshot: snapshot, baseState });
    setBonusResult({ correct, answer: challenge.answer });
    setFeedback(correct ? 'Mini Boss cleared! Nice work.' : `Mini Boss complete. Answer: ${challenge.answer}`);
    setFeedbackTone(correct ? 'success' : 'info');
    triggerPulse(correct ? 'success' : 'info');
    triggerResultFlash(
      correct ? 'success' : 'info',
      correct ? 'Mini Boss complete!' : 'Mini Boss finished',
      correct ? 'Bonus score applied.' : `Answer: ${challenge.answer}`
    );
    setInput('');
    setShowTutor(false);
    setTutorStep(0);
  };

  const continueFromBonusResult = () => {
    if (!pendingBonusFinish) {
      finishRun(Boolean(bonusResult?.correct));
      return;
    }
    finishRun(pendingBonusFinish.bossAttempted, pendingBonusFinish.runSnapshot, pendingBonusFinish.baseState);
  };

  const askPuzzleClarifyingQuestion = () => {
    if (!run.currentPuzzle || !clarifyInput.trim()) return;
    setClarifyReply(getClarifyingReply(run.currentPuzzle, clarifyInput, run.currentHints));
  };

  const getKidStrategyLine = (tags: string[]) => {
    if (tags.includes('mult_div')) return 'Break a number into smaller parts.';
    if (tags.includes('fractions')) return 'Compare which piece is bigger.';
    if (tags.includes('equations')) return 'Undo one step at a time.';
    if (tags.includes('geometry_area')) return 'Area is squares inside. Perimeter is walking the edge.';
    if (tags.includes('ratios_rates')) return 'Use the same times number on both sides.';
    if (tags.includes('percents')) return 'Percent means out of 100.';
    if (tags.includes('order_ops')) return 'Circle the multiply or divide chunk first.';
    if (tags.includes('counting')) return 'Try a smaller example first.';
    if (tags.includes('logic')) return 'Use clues and cross out wrong picks.';
    return 'Take it one small step at a time.';
  };

  const getFlowPromptLines = (item: FlowItem): { lead: string; detail?: string } => {
    if (item.template === 'fraction_compare') {
      const match = item.prompt.match(/^(\d+\s*\/\s*\d+)\s+or\s+(\d+\s*\/\s*\d+)\s*:\s*larger\??$/i);
      if (match) {
        return { lead: 'Which is larger?', detail: `${match[1]} or ${match[2]}` };
      }
    }
    return { lead: item.prompt };
  };

  const getFlowTutorSteps = (item: FlowItem) => {
    if (item.template === 'lcm') {
      const match =
        item.prompt.match(/Smallest shared multiple:\s*(\d+)\s*and\s*(\d+)/i) ??
        item.prompt.match(/Smallest shared multiple of\s*(\d+)\s*and\s*(\d+)\s*=\s*\?/i);
      if (match) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        return [
          `Step 1: We want the smallest number that ${a} and ${b} both go into evenly.`,
          "Step 2: That's the smallest shared multiple (also called the least common multiple).",
          'Step 3: List multiples of each number until you see the first match.',
          'Step 4: The first match is the answer.'
        ];
      }
    }

    if (item.shapeSignature === 'geom_rect_perim') {
      const rectMatch = item.prompt.match(/Rectangle:\s*(\d+)\s*by\s*(\d+)\.\s*Perimeter\s*=\s*\?/i);
      if (rectMatch) {
        const a = Number(rectMatch[1]);
        const b = Number(rectMatch[2]);
        return [
          'Step 1: Perimeter is the distance around the rectangle.',
          `Step 2: A rectangle has two ${a}s and two ${b}s.`,
          `Step 3: Add them: ${a}+${b}+${a}+${b}.`,
          `Step 4: That is 2×(${a}+${b}) = ${item.answer}.`
        ];
      }
    }

    if (item.shapeSignature === 'geom_rect_area') {
      const rectMatch = item.prompt.match(/Rectangle:\s*(\d+)\s*by\s*(\d+)\.\s*Area\s*=\s*\?/i);
      if (rectMatch) {
        const a = Number(rectMatch[1]);
        const b = Number(rectMatch[2]);
        const breakApart = buildTutorBreakPlan(a, b);
        return [
          'Step 1: Area means how many squares fit inside, so multiply side lengths.',
          `Step 2: Break ${breakApart.original} into ${breakApart.partA} and ${breakApart.partB} to make smaller facts.`,
          `Step 3: Rewrite ${breakApart.rewriteLine}.`,
          `Step 4: ${breakApart.partLineA}=${breakApart.valueA} and ${breakApart.partLineB}=${breakApart.valueB}; add to get ${item.answer}.`
        ];
      }
    }

    if (item.shapeSignature === 'geom_tri_area') {
      const triMatch = item.prompt.match(/Triangle:\s*base\s*(\d+),\s*height\s*(\d+)\.\s*Area\s*=\s*\?/i);
      if (triMatch) {
        const base = Number(triMatch[1]);
        const height = Number(triMatch[2]);
        const product = base * height;
        return [
          'Step 1: Area = (base × height) ÷ 2.',
          `Step 2: ${base}×${height} = ${product}.`,
          `Step 3: ${product} ÷ 2 = ${item.answer}.`
        ];
      }
    }

    if (item.tags.includes('geometry_area')) {
      return [
        `Step 1: ${getGeometryCoachLine(item.prompt)}`,
        'Step 2: Try your best answer. You can always adjust.'
      ];
    }

    if (item.tags.includes('mult_div') && item.prompt.includes('÷')) {
      const divisionMatch = item.prompt.match(/(\d+)\s*÷\s*(\d+)\s*=\s*\?/);
      const divideHint = divisionMatch
        ? `Think in groups: how many groups of ${divisionMatch[2]} fit in ${divisionMatch[1]}?`
        : 'Think in groups: how many groups of the second number fit in the first?';
      return [
        'Step 1: Find how many equal groups fit.',
        `Step 2: ${divideHint}`,
        'Step 3: Check with multiplication to confirm.'
      ];
    }

    if (item.template === 'ratio') {
      const ratioMatch = item.prompt.match(/^(\d+):(\d+)\s*=\s*x:(\d+)$/);
      if (ratioMatch) {
        const leftA = Number(ratioMatch[1]);
        const leftB = Number(ratioMatch[2]);
        const rightB = Number(ratioMatch[3]);
        const scale = rightB / Math.max(1, leftB);
        const answer = Number(item.answer);
        return [
          `Step 1: How did ${leftB} change to ${rightB}?`,
          `Step 2: It is ×${formatCoachNumber(scale)}, so ${leftB} × ${formatCoachNumber(scale)} = ${rightB}.`,
          `Step 3: Do the same to ${leftA}: ${leftA} × ${formatCoachNumber(scale)} = ${answer}. So x = ${answer}.`
        ];
      }
    }

    if (item.template === 'mult_div') {
      const multiplyMatch = item.prompt.match(/^\s*(\d+)\s*[×x]\s*(\d+)\s*=\s*\?\s*$/);
      if (multiplyMatch) {
        const left = Number(multiplyMatch[1]);
        const right = Number(multiplyMatch[2]);
        const result = Number(item.answer);
        if (left <= 12 && right <= 12) {
          return [
            'Step 1: Use a times-table fact you already know.',
            `Step 2: Check ${left}×${right} with skip counting.`,
            `Step 3: The product is ${result}.`
          ];
        }
        const breakApart = buildTutorBreakPlan(left, right);
        return [
          `Step 1: Break ${breakApart.original} into ${breakApart.partA} and ${breakApart.partB} so each part is easier.`,
          `Step 2: Rewrite ${breakApart.rewriteLine}.`,
          `Step 3: Solve each part: ${breakApart.partLineA}=${breakApart.valueA}, ${breakApart.partLineB}=${breakApart.valueB}.`,
          `Step 4: Add ${breakApart.valueA}+${breakApart.valueB} to get ${result}.`
        ];
      }
    }

    if (item.template === 'order_ops') {
      const parenMatch = item.prompt.match(/^\((\d+)\s*\+\s*(\d+)\)\s*×\s*(\d+)(?:\s*-\s*(\d+))?\s*=\s*\?\s*$/);
      if (parenMatch) {
        const a = Number(parenMatch[1]);
        const b = Number(parenMatch[2]);
        const c = Number(parenMatch[3]);
        const d = parenMatch[4] ? Number(parenMatch[4]) : null;
        const chunk = a + b;
        const product = chunk * c;
        const tailText = d === null ? '' : ` - ${d}`;
        const finalValue = d === null ? product : product - d;
        return [
          `Step 1: Find the chunk first: (${a} + ${b}) = ${chunk}.`,
          `Step 2: Plug back in: ${chunk} × ${c}${tailText}.`,
          `Step 3: Multiply: ${chunk}×${c} = ${product}.`,
          `Step 4: Finish the last step to get ${finalValue}.`
        ];
      }

      const orderMatch = item.prompt.match(/^(\d+)\s*\+\s*(\d+)\s*×\s*(\d+)(?:\s*-\s*(\d+))?\s*=\s*\?\s*$/);
      if (orderMatch) {
        const a = Number(orderMatch[1]);
        const b = Number(orderMatch[2]);
        const c = Number(orderMatch[3]);
        const d = orderMatch[4] ? Number(orderMatch[4]) : null;
        const breakApart = buildTutorBreakPlan(b, c);
        const product = b * c;
        const tailText = d === null ? '' : ` - ${d}`;
        const finalValue = d === null ? a + product : a + product - d;
        return [
          `Step 1: Do multiplication first, so solve ${b}×${c} before adding or subtracting.`,
          `Step 2: Break it into parts: ${breakApart.rewriteLine}.`,
          `Step 3: Plug back in: ${a} + ${product}${tailText}.`,
          `Step 4: Finish the line to get ${finalValue}.`
        ];
      }
    }

    const firstHint = item.hints[0] ? simplifyCoachLine(item.hints[0]) : 'Start with what you already know.';
    return [
      `Step 1: ${getKidStrategyLine(item.tags)}`,
      `Step 2: ${firstHint}`,
      'Step 3: Try your best answer. You can always adjust.'
    ];
  };

  const getPuzzleTutorSteps = (item: PuzzleItem) => {
    const explicitSteps = (item.solution_steps ?? [])
      .slice(0, 3)
      .map((step, index) => `Step ${index + 1}: ${simplifyCoachLine(step)}`);
    if (explicitSteps.length === 3) return explicitSteps;

    const firstHint = item.hint_ladder[0] ? simplifyCoachLine(item.hint_ladder[0]) : 'Break it into tiny parts.';
    const secondHint = item.hint_ladder[1] ? simplifyCoachLine(item.hint_ladder[1]) : 'Try one small example.';
    return [
      `Step 1: ${getKidStrategyLine(item.tags)}`,
      `Step 2: ${firstHint || secondHint}`,
      'Step 3: Finish with one clear answer.'
    ];
  };

  const completeOnboarding = async () => {
    const username = nameInput.trim();
    const chosenAvatarId = getCharacterById(selectedCharacterId)?.id ?? state.user?.avatarId;
    if (!username || !chosenAvatarId || isRegisteringPlayer) return;

    const localId =
      state.user?.userId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
    const createdAt = state.user?.createdAt ?? new Date().toISOString();

    const saveLocalProfile = (nextUsername: string, nextUserId = localId, nextCreatedAt = createdAt) => {
      const nextState: AppState = {
        ...state,
        user: {
          userId: nextUserId,
          username: nextUsername,
          avatarId: chosenAvatarId,
          createdAt: nextCreatedAt
        }
      };
      save(nextState);
      setNameInput(nextUsername);
      setScreen('home');
    };

    if (!canJoinGlobalLeaderboard) {
      // Keep new players local-only until they pass the global leaderboard threshold.
      saveLocalProfile(username);
      return;
    }

    setIsRegisteringPlayer(true);
    try {
      const registered = await registerPlayer({
        userId: localId,
        username,
        avatarId: chosenAvatarId
      });
      saveLocalProfile(registered.username, registered.userId, registered.createdAt);
      setLeaderboardStatus('online');
    } catch {
      // Fallback to local save if backend is unavailable.
      saveLocalProfile(username);
      setLeaderboardStatus('offline');
    } finally {
      setIsRegisteringPlayer(false);
    }
  };

  const continueToCharacterStep = () => {
    if (!nameInput.trim()) return;
    setOnboardingStage('character');
  };

  const pickOnboardingCharacter = (characterId: string) => {
    setSelectedCharacterId(characterId);
    if (celebrateCharacterTimeoutRef.current) {
      clearTimeout(celebrateCharacterTimeoutRef.current);
      celebrateCharacterTimeoutRef.current = null;
    }
    setCelebratingCharacterId(null);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => setCelebratingCharacterId(characterId));
    } else {
      setCelebratingCharacterId(characterId);
    }
    celebrateCharacterTimeoutRef.current = setTimeout(() => {
      setCelebratingCharacterId((activeId) => (activeId === characterId ? null : activeId));
      celebrateCharacterTimeoutRef.current = null;
    }, 1150);
  };

  const onOnboardingPrimaryAction = () => {
    if (isEditingProfile) {
      completeOnboarding();
      return;
    }
    if (!selectedCharacter) {
      return;
    }
    completeOnboarding();
  };

  useEffect(() => {
    if (screen !== 'onboarding') return;
    setOnboardingStage(state.user ? 'character' : 'name');
  }, [screen, state.user?.userId]);

  useEffect(() => {
    if (screen !== 'museum') setExpandedMuseumPuzzleId(null);
  }, [screen]);

  useEffect(() => {
    setExpandedMuseumPuzzleId(null);
  }, [showAttemptedPuzzles]);

  const museumRows = useMemo(
    () =>
      state.museum.map((entry) => ({ ...entry, title: toFriendlyPuzzleTitle(entry.title, entry.puzzleId) })),
    [state.museum]
  );
  const solvedRows = useMemo(() => museumRows.filter((entry) => entry.solved), [museumRows]);
  const uniqueTriedCount = museumRows.length;
  const collectionRows = showAttemptedPuzzles ? museumRows : solvedRows;

  const leaderboardMetricIcon = leaderboardMode === 'all_time' ? '☄️' : leaderboardMode === 'best_run' ? '🚀' : '🏆';
  const leaderboardMetricLabel = leaderboardMode === 'all_time' ? 'Stars' : leaderboardMode === 'best_run' ? 'Best Run' : 'Trophies';

  const leaderboardSourceRows = useMemo(() => {
    const youUserId = state.user?.userId;
    const youUsername = state.user?.username;
    const fallbackRows = buildLeaderboardEntries(
      leaderboardMode,
      {
        userId: youUserId,
        username: youUsername,
        avatarId: state.user?.avatarId ?? defaultCharacterId,
        allTimeStars: state.totals.allTimeStars,
        bestRunStars: state.totals.bestRunStars,
        trophiesEarned: state.totals.trophiesEarned,
        extensionsSolved: state.totals.extensionsSolved
      }
    );
    return networkLeaderboardRows && networkLeaderboardRows.length > 0 ? networkLeaderboardRows : fallbackRows;
  }, [leaderboardMode, networkLeaderboardRows, state.totals, state.user]);

  const leaderboard = useMemo(() => {
    const youUserId = state.user?.userId;
    const youUsername = state.user?.username;

    return leaderboardSourceRows.map((entry) => ({
      rank: entry.rank,
      userId: entry.userId,
      name: entry.username,
      avatarId: entry.avatarId,
      primaryValue: getLeaderboardPrimaryValue(entry, leaderboardMode),
      allTimeStars: entry.allTimeStars,
      bestRunStars: entry.bestRunStars,
      trophiesEarned: entry.trophiesEarned,
      extensionsSolved: entry.extensionsSolved,
      isBot: entry.isBot,
      isYou: youUserId ? entry.userId === youUserId : entry.username === youUsername
    }));
  }, [leaderboardMode, leaderboardSourceRows, state.user]);

  const pinnedYouRow = useMemo(() => {
    if (!state.user) return null;
    if (!canJoinGlobalLeaderboard) return null;
    if (leaderboard.some((entry) => entry.isYou)) return null;

    const userId = state.user.userId ?? `local-${state.user.username.toLowerCase().replace(/\s+/g, '-')}`;
    const userRow: LeaderboardRow = {
      rank: 0,
      userId,
      username: state.user.username,
      avatarId: state.user.avatarId ?? defaultCharacterId,
      allTimeStars: state.totals.allTimeStars,
      bestRunStars: state.totals.bestRunStars,
      trophiesEarned: state.totals.trophiesEarned,
      extensionsSolved: state.totals.extensionsSolved,
      updatedAt: state.user.createdAt ?? new Date().toISOString()
    };

    const ranked = sortLeaderboardRows([...leaderboardSourceRows, userRow], leaderboardMode).map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
    const found = ranked.find((entry) => entry.userId === userId || entry.username === state.user?.username);
    if (!found) return null;

    return {
      rank: found.rank,
      userId: found.userId,
      name: found.username,
      avatarId: found.avatarId,
      primaryValue: getLeaderboardPrimaryValue(found, leaderboardMode),
      allTimeStars: found.allTimeStars,
      bestRunStars: found.bestRunStars,
      trophiesEarned: found.trophiesEarned,
      extensionsSolved: found.extensionsSolved,
      isBot: found.isBot,
      isYou: true
    };
  }, [canJoinGlobalLeaderboard, leaderboard, leaderboardMode, leaderboardSourceRows, state.totals, state.user]);

  const podiumLeaders = useMemo(
    () =>
      [2, 1, 3]
        .map((rank) => leaderboard.find((entry) => entry.rank === rank))
        .filter((entry): entry is (typeof leaderboard)[number] => entry !== undefined),
    [leaderboard]
  );

  const hideBottomNav =
    isMobileViewport &&
    (screen === 'run' || (screen === 'home' && !homeNavRevealed) || isTextEntryFocused);
  const showGamePhasesPanel = false;
  const currentFlowTutorSteps = run.currentFlow ? getFlowTutorSteps(run.currentFlow) : [];
  const flowPromptLines = run.currentFlow ? getFlowPromptLines(run.currentFlow) : null;
  const flowHasChoices = (run.currentFlow?.choices?.length ?? 0) > 0;
  const currentPuzzleTutorSteps = run.currentPuzzle ? getPuzzleTutorSteps(run.currentPuzzle) : [];
  const currentFlowCoachVisual = run.currentFlow ? getCoachVisual(run.currentFlow) : null;
  const currentPuzzleCoachVisual = run.currentPuzzle ? getCoachVisual(run.currentPuzzle) : null;
  const activeBonus = run.bonusChallenge ?? fallbackBonusChallenge;
  const currentBonusTutorSteps = (activeBonus.solutionSteps ?? []).map((step, index) => `Step ${index + 1}: ${step}`);
  const bonusChoiceOptions = getBonusChoiceOptions(activeBonus);
  const bonusBefore = run.brainScore;
  const bonusAfter = bonusBefore * 2;
  const openCaptainEditor = () => {
    if (!state.user) return;
    setNameInput(state.user.username);
    setSelectedCharacterId(getCharacterById(state.user.avatarId)?.id ?? defaultCharacterId);
    setScreen('onboarding');
  };

  const renderScratchpad = (idSuffix: string) => {
    const fieldId = `${scratchpadFieldId}-${idSuffix}`;
    const shouldShowInput = !isMobileViewport || scratchpadExpanded;
    return (
      <div className={`scratchpad-wrap ${isMobileViewport && !scratchpadExpanded ? 'collapsed' : ''}`}>
        <button
          type="button"
          className="scratchpad-toggle"
          onClick={() => setScratchpadExpanded((open) => !open)}
          aria-expanded={shouldShowInput}
          aria-controls={fieldId}
        >
          <span className="scratchpad-label">Scratchpad</span>
          {isMobileViewport && <span className="scratchpad-toggle-text">{shouldShowInput ? 'Hide' : 'Show'}</span>}
        </button>
        {shouldShowInput && (
          <textarea
            ref={scratchpadRef}
            id={fieldId}
            className="math-input text-area-input scratchpad-input"
            inputMode="text"
            value={scratchpad}
            onChange={onScratchpadChange}
            placeholder={scratchpadPlaceholder}
            rows={3}
          />
        )}
      </div>
    );
  };

  const continueFromLanding = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANDING_SEEN_STORAGE_KEY, '1');
    }
    setScreen(state.user ? 'home' : 'onboarding');
  };

  const landing = (
    <div className={`landing-shell landing-${brandVariant}`}>
      <div className="landing-stars" aria-hidden="true" />
      <section className="landing-card">
        <div className="landing-logo-lockup">
          <div className="landing-brand">
            <BrandMark size="lg" />
          </div>
          {brandVariant === 'simplified' ? (
            <>
              <span className="landing-character landing-character-astro">
                <CharacterAvatar characterId="astro-bot" size="md" />
              </span>
              <span className="landing-character landing-character-jelly">
                <CharacterAvatar characterId="animal-jelly-jet" size="md" />
              </span>
              <span className="landing-character landing-character-mochi">
                <CharacterAvatar characterId="animal-moon-mochi" size="md" />
              </span>
            </>
          ) : (
            <>
              <span className="landing-character landing-character-axo">
                <CharacterAvatar characterId="animal-axo-naut" size="md" />
              </span>
              <span className="landing-character landing-character-jelly">
                <CharacterAvatar characterId="animal-jelly-jet" size="md" />
              </span>
              <span className="landing-character landing-character-blob">
                <CharacterAvatar characterId="animal-glowing-gloop" size="md" />
              </span>
            </>
          )}
        </div>
        <h1 className="landing-title">
          Galaxy {brandVariant === 'simplified' ? <span>Genius</span> : 'Genius'}
        </h1>
        {brandVariant === 'classic' && <p className="landing-tagline">Big Brains. Space Games.</p>}
        <div className="landing-actions">
          <button className="btn btn-primary" onClick={continueFromLanding}>
            {state.user ? `Continue as ${state.user.username}` : brandVariant === 'simplified' ? 'Start Mission' : 'Start Playing'}
          </button>
        </div>
      </section>
    </div>
  );

  const onboarding = (
    <div className="auth-shell">
      <div className="card onboarding-card">
        <div className="onboarding-brand">
          <BrandMark size="sm" />
          <div className="onboarding-brand-copy">
            <p className="onboarding-brand-name">Galaxy Genius</p>
            {brandVariant === 'classic' && <p className="onboarding-brand-tagline">Big Brains. Space Games.</p>}
          </div>
        </div>

        {isEditingProfile ? (
          <>
            <h1 className="onboarding-title">Update Cadet Profile</h1>
            <p className="muted onboarding-intro">Change your cadet name or switch your character.</p>
          </>
        ) : (
          <>
            {onboardingStage === 'name' ? (
              <>
                <h1 className="onboarding-title">Welcome, Space Cadet!</h1>
                <p className="muted onboarding-intro">Blast through math missions and level up.</p>
              </>
            ) : (
              <>
                <h1 className="onboarding-title">Welcome aboard, {onboardingCadetName}!</h1>
                <p className="muted onboarding-intro">Pick your space buddy to start your first mission.</p>
              </>
            )}
          </>
        )}

        {(isEditingProfile || onboardingStage === 'name') && (
          <div className="onboarding-name-block onboarding-phase-block">
            <p className="text-label onboarding-step-label">{isEditingProfile ? 'Cadet name' : 'Choose your cadet name'}</p>
            <input
              className="math-input"
              placeholder="RocketRyder11"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                if (isEditingProfile) completeOnboarding();
                else continueToCharacterStep();
              }}
            />
            {!isEditingProfile && (
              <>
                <button className="btn btn-primary onboarding-continue-btn" disabled={!nameInput.trim()} onClick={continueToCharacterStep}>
                  Beam Me Up
                </button>
              </>
            )}
          </div>
        )}

        {(isEditingProfile || onboardingStage === 'character') && (
          <>
            <div className="character-section onboarding-phase-block onboarding-character-section">
              <p className="text-label onboarding-step-label">{isEditingProfile ? 'Choose Character' : 'Choose your buddy'}</p>
              <div className="character-grid">
                {playerCharacters.map((character) => (
                  <button
                    key={character.id}
                    className={`character-card jump-${characterVariantById[character.id] ?? 'astro-bot'} ${selectedCharacterId === character.id ? 'selected' : ''} ${celebratingCharacterId === character.id ? 'celebrate' : ''}`}
                    onClick={() => pickOnboardingCharacter(character.id)}
                  >
                    {selectedCharacterId === character.id && <span className="character-selected-badge">✓</span>}
                    <div className="character-card-head">
                      <CharacterAvatar characterId={character.id} size="lg" />
                    </div>
                    <span className="character-name">{character.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {(isEditingProfile || onboardingStage === 'character') && (
          <div className="onboarding-footer">
            <div className="btn-row">
              <button
                className={`btn btn-primary ${!isEditingProfile && !selectedCharacter ? 'btn-soft-lock' : ''}`}
                disabled={isRegisteringPlayer || (isEditingProfile && (!nameInput.trim() || !selectedCharacter))}
                onClick={onOnboardingPrimaryAction}
              >
                {isRegisteringPlayer ? 'Saving...' : isEditingProfile ? 'Save Player' : selectedCharacter ? 'Start Mission' : 'Choose a buddy to launch'}
              </button>
              {isEditingProfile && (
                <button className="btn btn-secondary" onClick={() => setScreen('home')}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const home = (
    <>
      <section className="section-header mission-header">
        <div className="section-head-copy">
          <h2 className="text-title">Mission Control</h2>
        </div>
        <span className="tag">Explorer Level {explorerLevel}</span>
      </section>
      <button className="card home-hero home-hero-button" onClick={openCaptainEditor} aria-label="Edit captain" type="button">
        <div className="home-hero-head">
          <div className="home-hero-main">
            <div className="selected-player-avatar home-hero-avatar">
              <CharacterAvatar characterId={homeCharacterId} size="lg" />
            </div>
            <div className="home-hero-copy">
              <h3 className="home-hero-title">Ready for launch, {homeCadetName}?</h3>
            </div>
          </div>
          <span className="home-hero-edit-affordance" aria-hidden="true">›</span>
        </div>
      </button>

      <section className="card mission-launch-card">
        <p className="text-label mission-label">Choose your mission:</p>
        <div className="mode-card-grid">
          {(Object.keys(modeConfig) as GameMode[]).map((mode) => (
            <button
              key={mode}
              className={`mode-card-option ${selectedMode === mode ? 'selected' : ''}`}
              onClick={() => {
                setSelectedMode(mode);
                startRun(mode);
              }}
            >
              <span className="mode-card-head">
                <span className="mode-card-title">{modeConfig[mode].icon} {modeConfig[mode].name}</span>
                <span className="mode-card-counts">
                  {modeConfig[mode].flowTarget > 0 && modeConfig[mode].puzzleTarget > 0
                    ? `⚡ ${modeConfig[mode].flowTarget} + 🧩 ${modeConfig[mode].puzzleTarget}`
                    : modeConfig[mode].flowTarget > 0
                      ? `⚡ ${modeConfig[mode].flowTarget}`
                      : `🧩 ${modeConfig[mode].puzzleTarget}`}
                </span>
              </span>
              <span className="mode-card-subtitle">{modeConfig[mode].subtitle}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section-header">
        <h3 className="text-title">Cosmic Snapshot</h3>
        <span className="tag">Your mission stats</span>
      </section>

      <section className="card home-stats-card">
        <div className="stats-grid stats-grid-embedded">
          <div className="stat-card">
            <span className="stat-value">{state.highs.bestTotal}</span>
            <span className="stat-label">⭐ Best Score</span>
          </div>
          <div className="stat-card">
            <span className="stat-value accent">{state.streaks.dailyStreak}</span>
            <span className="stat-label">🔥 Day Streak</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{puzzleSolveRate}%</span>
            <span className="stat-label">🧠 Puzzles Solved</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{state.museum.length}</span>
            <span className="stat-label">🏆 Trophies</span>
          </div>
        </div>
      </section>
    </>
  );

  const runView = (
    <>
      <section className={`card run-main-card ${resultPulse ? `pulse-${resultPulse}` : ''}`}>
        {run.phase === 'flow' && run.currentFlow && (
          <>
            <div className="tier-row">
              <span className="tag difficulty-tag">{getTier(run.currentFlow.difficulty, run.currentFlow.tier).icon} {getTier(run.currentFlow.difficulty, run.currentFlow.tier).label}</span>
            </div>
            <h3 className={`math-display ${flowPromptLines?.detail ? 'math-display-split' : ''}`}>
              <span className="math-display-line"><InlineMathText text={flowPromptLines?.lead ?? run.currentFlow.prompt} /></span>
              {flowPromptLines?.detail && <span className="math-display-line math-display-detail"><InlineMathText text={flowPromptLines.detail} /></span>}
            </h3>

            {flowHasChoices && (
              <div className="chips">
                {run.currentFlow.choices!.map((choice) => (
                  <button
                    key={choice}
                    className={`btn btn-secondary chip-btn ${input === choice ? 'selected' : ''}`}
                    onClick={() => setInput(choice)}
                  >
                    <InlineMathText text={choice} />
                  </button>
                ))}
              </div>
            )}

            {!flowHasChoices && (
              <input
                className="math-input"
                inputMode={run.currentFlow.format === 'numeric_input' ? 'numeric' : 'text'}
                pattern={run.currentFlow.format === 'numeric_input' ? '[0-9]*' : undefined}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Answer"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmitFlow();
                }}
              />
            )}

            <div className="btn-row">
              <button className="btn btn-primary btn-primary-main" onClick={onSubmitFlow} disabled={!input.trim()}>
                <span aria-hidden="true">🚀</span> Blast Off!
              </button>
            </div>
            <div className="helper-actions">
              <button
                className="btn btn-secondary utility-btn"
                onClick={() => {
                  setShowTutor(true);
                  setShowClarifyDialog(false);
                  setTutorStep(0);
                }}
              >
                <span aria-hidden="true">🧑‍🏫</span> Teach me
              </button>
              {run.currentHints < run.currentFlow.hints.length && (
                <button
                  className="btn btn-secondary utility-btn"
                  onClick={() =>
                    setRun({
                      ...run,
                      currentHints: Math.min(run.currentHints + 1, run.currentFlow?.hints.length ?? 0)
                    })
                  }
                >
                  <span aria-hidden="true">😉</span> {run.currentHints === 0 ? 'Show hint' : 'Next hint'}
                </button>
              )}
            </div>
            {run.currentHints > 0 && (
              <div className="hint-stack">
                {run.currentFlow.hints.slice(0, run.currentHints).map((hint, index) => (
                  <p key={hint} className="hint-box">
                    Hint {index + 1}: {hint}
                  </p>
                ))}
              </div>
            )}

            {showTutor && (
              <div className="tutor-panel">
                <p className="tutor-label">Mini Coach</p>
                {currentFlowCoachVisual && <CoachVisual visual={currentFlowCoachVisual} />}
                <p className="tutor-step">{currentFlowTutorSteps[tutorStep]}</p>
                <div className="btn-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setTutorStep((step) => Math.max(step - 1, 0))}
                    disabled={tutorStep === 0}
                  >
                    Back
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      setTutorStep((step) => Math.min(step + 1, currentFlowTutorSteps.length - 1))
                    }
                    disabled={tutorStep >= currentFlowTutorSteps.length - 1}
                  >
                    Next Step
                  </button>
                </div>
                <button className="btn btn-secondary" onClick={() => setShowTutor(false)}>
                  Got it
                </button>
              </div>
            )}

            {renderScratchpad('flow')}
          </>
        )}

        {run.phase === 'puzzle_pick' && (
          <>
            <h3>Pick Puzzle Card {run.puzzleDone + 1}/{run.puzzleTarget}</h3>
            <div className="puzzle-grid">
              {(run.currentPuzzleChoices.length ? run.currentPuzzleChoices : getPuzzleChoices(state.skill.rating, run.usedPuzzleIds)).map((puzzle) => (
                <button key={puzzle.id} className="puzzle-card" onClick={() => selectPuzzle(puzzle)}>
                  <span className="emoji">{getPuzzleEmoji(puzzle)}</span>
                  <strong>{puzzle.title}</strong>
                  <span className="difficulty-tag difficulty-tag-small">{getTier(puzzle.difficulty).icon} {getTier(puzzle.difficulty).label}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={setupPuzzlePick}>Shuffle Cards</button>
          </>
        )}

        {run.phase === 'puzzle' && run.currentPuzzle && (
          <>
            <div className="tier-row">
              <span className="tag difficulty-tag">{getTier(run.currentPuzzle.difficulty).icon} {getTier(run.currentPuzzle.difficulty).label}</span>
            </div>
            <h3 className="puzzle-question-title">{run.currentPuzzle.title}</h3>
            <p className="puzzle-question-prompt"><InlineMathText text={cleanPuzzlePromptDisplay(run.currentPuzzle.core_prompt)} /></p>
            {getPuzzleInputMode(run.currentPuzzle) === 'choice' ? (
              <div className="chips">
                {getPuzzleChoiceOptions(run.currentPuzzle).map((choice) => (
                  <button
                    key={choice}
                    className={`btn btn-secondary chip-btn ${normalize(input) === normalize(choice) ? 'selected' : ''}`}
                    onClick={() => setInput(choice)}
                  >
                    <InlineMathText text={cleanChoiceMarker(choice)} />
                  </button>
                ))}
              </div>
            ) : getPuzzleInputMode(run.currentPuzzle) === 'long_text' ? (
              <textarea
                className="math-input text-area-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Write your thinking in one short sentence"
                rows={3}
              />
            ) : (
              <input
                className="math-input"
                inputMode={expectsNumericInput(run.currentPuzzle.core_answer, run.currentPuzzle.accept_answers) ? 'numeric' : 'text'}
                pattern={expectsNumericInput(run.currentPuzzle.core_answer, run.currentPuzzle.accept_answers) ? '[0-9]*' : undefined}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Your answer"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitPuzzle();
                }}
              />
            )}

            <div className="btn-row">
              <button className="btn btn-primary btn-primary-main" onClick={submitPuzzle} disabled={!input.trim()}>
                <span aria-hidden="true">🚀</span> Blast Off!
              </button>
            </div>
            <div className="helper-actions puzzle-helper-actions">
              <button
                className="btn btn-secondary utility-btn"
                onClick={() => {
                  setShowTutor(true);
                  setShowClarifyDialog(false);
                  setTutorStep(0);
                }}
              >
                <span aria-hidden="true">🧑‍🏫</span> Teach me
              </button>
              <button
                className="btn btn-secondary utility-btn"
                onClick={() => setRun({ ...run, currentHints: Math.min(run.currentHints + 1, MAX_PUZZLE_HINTS) })}
                disabled={run.currentHints >= MAX_PUZZLE_HINTS}
              >
                <span aria-hidden="true">😉</span> Hint
              </button>
              <button
                className="btn btn-secondary help-circle-btn"
                onClick={() => {
                  setShowClarifyDialog(true);
                  setShowTutor(false);
                }}
                aria-label="Help"
                title="Help"
              >
                ?
              </button>
            </div>
            {run.currentHints > 0 && (
              <div className="hint-stack">
                {run.currentPuzzle.hint_ladder.slice(0, run.currentHints).map((hint, index) => (
                  <p key={hint} className="hint-box">
                    Hint {index + 1}: {hint}
                  </p>
                ))}
              </div>
            )}

            {showTutor && (
              <div className="tutor-panel">
                <p className="tutor-label">Mini Coach</p>
                {currentPuzzleCoachVisual && <CoachVisual visual={currentPuzzleCoachVisual} />}
                <p className="tutor-step">{currentPuzzleTutorSteps[tutorStep]}</p>
                <div className="btn-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setTutorStep((step) => Math.max(step - 1, 0))}
                    disabled={tutorStep === 0}
                  >
                    Back
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      setTutorStep((step) => Math.min(step + 1, currentPuzzleTutorSteps.length - 1))
                    }
                    disabled={tutorStep >= currentPuzzleTutorSteps.length - 1}
                  >
                    Next Step
                  </button>
                </div>
                <button className="btn btn-secondary" onClick={() => setShowTutor(false)}>
                  Got it
                </button>
              </div>
            )}

            {showClarifyDialog && (
              <div className="tutor-panel">
                <p className="tutor-label">Question Box</p>
                <div className="ask-help">
                  <input
                    className="math-input ask-input"
                    value={clarifyInput}
                    onChange={(event) => setClarifyInput(event.target.value)}
                    placeholder="Clarify the question"
                  />
                  <button className="btn btn-primary" onClick={askPuzzleClarifyingQuestion} disabled={!clarifyInput.trim()}>
                    Ask
                  </button>
                </div>
                {clarifyReply && <p className="tutor-step ask-reply">Mission Coach: {clarifyReply}</p>}
                <button className="text-cta" onClick={() => setShowClarifyDialog(false)}>
                  Close
                </button>
              </div>
            )}

            <button className="text-cta" onClick={setupPuzzlePick}>Pick a different puzzle</button>

            {renderScratchpad('puzzle')}
          </>
        )}

        {run.phase === 'boss' && (
          <>
            {run.bossStage === 'intro' ? (
              <>
                <h3>Bonus Round: Mini Boss</h3>
                <p className="muted">Mission type: {activeBonus.puzzleType} • {activeBonus.label}</p>
                <p>Take on this hard puzzle to double your puzzle points this game.</p>
                <p className="puzzle-question-prompt"><InlineMathText text={cleanPuzzlePromptDisplay(activeBonus.prompt)} /></p>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={startBonusRound}>Start Mini Boss</button>
                  <button className="btn btn-secondary" onClick={() => finishRun(false)}>Finish Game</button>
                </div>
                <p className="muted">Bonus preview: {bonusBefore} → {bonusAfter}</p>
              </>
            ) : run.bossStage === 'question' ? (
              <>
                <h3>Bonus Round: Mini Boss</h3>
                <p className="muted">{activeBonus.title} • {activeBonus.label}</p>
                <p className="puzzle-question-prompt"><InlineMathText text={activeBonus.prompt} /></p>
                {getBonusInputMode(activeBonus) === 'choice' ? (
                  <div className="chips">
                    {bonusChoiceOptions.map((choice) => (
                      <button
                        key={choice}
                        className={`btn btn-secondary chip-btn ${normalize(input) === normalize(choice) ? 'selected' : ''}`}
                        onClick={() => setInput(choice)}
                      >
                        <InlineMathText text={cleanChoiceMarker(choice)} />
                      </button>
                    ))}
                  </div>
                ) : getBonusInputMode(activeBonus) === 'long_text' ? (
                  <textarea
                    className="math-input text-area-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Write your strategy in one short sentence"
                    rows={3}
                  />
                ) : (
                  <input
                    className="math-input"
                    inputMode={expectsNumericInput(activeBonus.answer, activeBonus.acceptAnswers) ? 'numeric' : 'text'}
                    pattern={expectsNumericInput(activeBonus.answer, activeBonus.acceptAnswers) ? '[0-9]*' : undefined}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Your mini boss answer"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitBonusRound();
                    }}
                  />
                )}
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={submitBonusRound} disabled={!input.trim()}>
                    Submit Mini Boss Answer
                  </button>
                  <button className="btn btn-secondary" onClick={() => finishRun(false)}>
                    Skip Bonus
                  </button>
                </div>
                <div className="helper-actions puzzle-helper-actions">
                  <button
                    className="btn btn-secondary utility-btn"
                    onClick={() => {
                      setShowTutor(true);
                      setTutorStep(0);
                    }}
                  >
                    <span aria-hidden="true">🧑‍🏫</span> Teach me
                  </button>
                  <button
                    className="btn btn-secondary utility-btn"
                    onClick={() => setRun({ ...run, currentHints: Math.min(run.currentHints + 1, MAX_PUZZLE_HINTS) })}
                    disabled={run.currentHints >= MAX_PUZZLE_HINTS}
                  >
                    <span aria-hidden="true">😉</span> {run.currentHints === 0 ? 'Show hint' : 'Next hint'}
                  </button>
                </div>
                {run.currentHints > 0 && (
                  <div className="hint-stack">
                    {activeBonus.hintLadder.slice(0, run.currentHints).map((hint, index) => (
                      <p key={hint} className="hint-box">
                        Hint {index + 1}: {hint}
                      </p>
                    ))}
                  </div>
                )}

                {showTutor && (
                  <div className="tutor-panel">
                    <p className="tutor-label">Mini Boss Coach</p>
                    <p className="tutor-step">
                      {currentBonusTutorSteps[Math.min(tutorStep, Math.max(currentBonusTutorSteps.length - 1, 0))] ?? 'Step 1: Break it into small parts.'}
                    </p>
                    <div className="btn-row">
                      <button
                        className="btn btn-secondary"
                        onClick={() => setTutorStep((step) => Math.max(step - 1, 0))}
                        disabled={tutorStep === 0}
                      >
                        Back
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          setTutorStep((step) => Math.min(step + 1, Math.max(currentBonusTutorSteps.length - 1, 0)))
                        }
                        disabled={tutorStep >= currentBonusTutorSteps.length - 1}
                      >
                        Next Step
                      </button>
                    </div>
                    <button className="btn btn-secondary" onClick={() => setShowTutor(false)}>
                      Got it
                    </button>
                  </div>
                )}

                {renderScratchpad('boss')}
              </>
            ) : (
              <div className="bonus-result-modal" role="dialog" aria-modal="true" aria-label="Bonus complete">
                <h3>{bonusResult?.correct ? 'Mini Boss Cleared!' : 'Mini Boss Complete'}</h3>
                <p className="muted">
                  {bonusResult?.correct
                    ? 'Awesome work. Your bonus puzzle points were doubled for this run.'
                    : `Nice attempt. The answer was ${bonusResult?.answer ?? activeBonus.answer}.`}
                </p>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={continueFromBonusResult}>
                    Continue to Stats
                  </button>
                </div>
              </div>
            )}
          </>
        )}

      </section>
      {showGamePhasesPanel && (
        <section className="card">
          <div className="card-head-row">
            <h3 className="text-title">Game Phases</h3>
          </div>
          <details className="reveal-panel">
            <summary>Show phases</summary>
            <div className="plan-list">
              <div className="plan-item">
                <div>
                  <p className="plan-title">Phase 1: Quick Questions</p>
                  <p className="muted">{Math.max(run.flowTarget - run.flowDone, 0)} left</p>
                </div>
              </div>
              <div className="plan-item">
                <div>
                  <p className="plan-title">Phase 2: Puzzle Cards</p>
                  <p className="muted">{Math.max(run.puzzleTarget - run.puzzleDone, 0)} left</p>
                </div>
              </div>
              <div className="plan-item">
                <div>
                  <p className="plan-title">Phase 3: Next Planet</p>
                  <p className="muted">
                    {run.phase === 'flow'
                      ? 'Clear this round to launch into your next space challenge.'
                      : run.phase === 'puzzle_pick' || run.phase === 'puzzle'
                        ? 'Solve puzzle cards to clear this planet.'
                        : 'Round complete. Launch to the next planet (next level).'}
                  </p>
                </div>
              </div>
            </div>
          </details>
        </section>
      )}
    </>
  );

  const summary = (
    <>
      <section className="section-header">
        <h2 className="text-title">Great Job!</h2>
        <span className="tag">Game Complete</span>
      </section>
      <section className="card">
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-value">{run.starsThisRound}</span>
            <span className="stat-label">Stars This Round</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{run.gameMode === 'rocket_rush' ? run.flowDone : run.puzzleDone}</span>
            <span className="stat-label">{run.gameMode === 'rocket_rush' ? 'Math solved' : 'Puzzle cards solved'}</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{state.totals.bestRunStars}</span>
            <span className="stat-label">Best Run</span>
          </div>
          <div className="stat-card">
            <span className="stat-value accent">{state.streaks.dailyStreak}</span>
            <span className="stat-label">Day streak</span>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => startRun(selectedMode)}>Play Again</button>
          <button className="btn btn-secondary" onClick={() => setScreen('scores')}>💫 Stars</button>
        </div>
      </section>
    </>
  );

  const scores = (
    <>
      <section className="section-header scoreboard-header">
        <h2 className="text-title">💫 Star Board</h2>
        <p className="muted scoreboard-subtitle">See who is leading the galaxy!</p>
      </section>
      <section className="list-container">
        <div className="leaderboard-tabs">
          <button
            className={`leaderboard-tab ${leaderboardMode === 'all_time' ? 'selected' : ''}`}
            onClick={() => setLeaderboardMode('all_time')}
          >
            ☄️ Stars
          </button>
          <button
            className={`leaderboard-tab ${leaderboardMode === 'best_run' ? 'selected' : ''}`}
            onClick={() => setLeaderboardMode('best_run')}
          >
            🚀 Best Run
          </button>
          <button
            className={`leaderboard-tab ${leaderboardMode === 'trophies' ? 'selected' : ''}`}
            onClick={() => setLeaderboardMode('trophies')}
          >
            🏆 Trophies
          </button>
        </div>
      </section>

      <section className="card podium-wrap leaderboard-podium">
        {podiumLeaders.map((entry) => (
          <div key={entry.userId} className={`podium-item rank-${entry.rank}`}>
            <div className="podium-avatar"><CharacterAvatar characterId={entry.avatarId} size="md" /></div>
            <strong>#{entry.rank}</strong>
            <span className="podium-name" title={entry.name}>{entry.name}</span>
            <small className="podium-score">{entry.primaryValue}</small>
            <div className="podium-bar" aria-hidden="true" />
          </div>
        ))}
      </section>

      <section className="list-container scoreboard-list">
        <div className="leaderboard-list-head">
          <span>Rank &amp; Player</span>
          <span>{leaderboardMetricIcon} {leaderboardMetricLabel}</span>
        </div>
        {leaderboard.map((entry) => (
          <div key={entry.userId} className={`rank-row scoreboard-row ${entry.isYou ? 'me' : ''} ${entry.rank <= 3 ? 'top' : ''}`}>
            <div className="rank-row-left">
              <span className="rank-number">#{entry.rank}</span>
              <span className="row-avatar"><CharacterAvatar characterId={entry.avatarId} size="sm" /></span>
                <span className="row-main">
                  <span className="row-name-line">
                    <span className="row-name" title={entry.name}>{entry.name}</span>
                    {entry.isYou && <span className="you-chip">YOU</span>}
                  </span>
                </span>
              </div>
              <span className="row-score">{entry.primaryValue}</span>
            </div>
        ))}
        {pinnedYouRow && (
          <>
            <p className="muted pinned-you-label">Your rank</p>
            <div className="rank-row scoreboard-row me pinned">
              <div className="rank-row-left">
                <span className="rank-number">#{pinnedYouRow.rank}</span>
                <span className="row-avatar"><CharacterAvatar characterId={pinnedYouRow.avatarId} size="sm" /></span>
                <span className="row-main">
                  <span className="row-name-line">
                    <span className="row-name" title={pinnedYouRow.name}>{pinnedYouRow.name}</span>
                    <span className="you-chip">YOU</span>
                  </span>
                </span>
              </div>
              <span className="row-score">{pinnedYouRow.primaryValue}</span>
            </div>
          </>
        )}
      </section>
    </>
  );

  const museum = (
    <>
      <section className="section-header">
        <h2 className="text-title">Trophy Galaxy</h2>
        <span className="tag">Collection</span>
      </section>

      <section className="card profile-hero collection-hero">
        <div className="pet-float"><CharacterAvatar characterId={state.user?.avatarId} size="lg" /></div>
        <h3>{state.user?.username}</h3>
        <p className="muted">This is your trophy shelf. Every solved puzzle earns a new space trophy.</p>
      </section>

      {SHOW_TROPHY_ACTIVITY_CARD && (
        <section className="card activity-card">
          <div className="activity-head">
            <h3>Activity</h3>
            <span>Last 7 days</span>
          </div>
          <div className="activity-bars">
            {activityBars.map((bar, index) => (
              <div key={`activity-${bar.label}-${index}`} className="activity-col">
                <div className="activity-track">
                  <div className={`activity-fill ${bar.isToday ? 'today' : ''}`} style={{ height: `${bar.height}%` }} />
                </div>
                <span className={`activity-day ${bar.isToday ? 'today' : ''}`}>{bar.label}</span>
              </div>
            ))}
          </div>
          <div className="activity-footer">
            <div>
              <p className="activity-meta-label">Total points</p>
              <p className="activity-meta-value">{state.totals.allTimeStars.toLocaleString()}</p>
            </div>
            <div className="activity-meta-right">
              <p className="activity-meta-label">Avg/session</p>
              <p className="activity-meta-value accent">{avgSessionPoints.toLocaleString()}</p>
            </div>
          </div>
        </section>
      )}

      <section className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{state.totals.trophiesEarned}</span>
          <span className="stat-label">Trophies</span>
        </div>
        <div className="stat-card">
          <span className="stat-value accent">{uniqueTriedCount}</span>
          <span className="stat-label">Tries</span>
        </div>
      </section>

      <section className="list-container">
        <div className="view-toggle">
          <button
            className={`btn btn-secondary chip-btn ${!showAttemptedPuzzles ? 'selected' : ''}`}
            onClick={() => setShowAttemptedPuzzles(false)}
          >
            Solved
          </button>
          <button
            className={`btn btn-secondary chip-btn ${showAttemptedPuzzles ? 'selected' : ''}`}
            onClick={() => setShowAttemptedPuzzles(true)}
          >
            Tries
          </button>
        </div>
      </section>

      <section className="list-container">
        {collectionRows.length === 0 && !showAttemptedPuzzles && (
          <div className="empty-state">
            <p>No trophies yet. Solve a puzzle to earn your first trophy.</p>
            <button className="btn btn-primary" onClick={() => startRun('puzzle_orbit')}>Play a Puzzle</button>
          </div>
        )}
        {collectionRows.length === 0 && showAttemptedPuzzles && (
          <div className="empty-state">No puzzle attempts yet. Start a game and pick a puzzle card.</div>
        )}
        {collectionRows.map((entry) => {
          const isExpanded = expandedMuseumPuzzleId === entry.puzzleId;
          const detailQuestion = entry.promptSnapshot
            ? cleanPuzzlePromptDisplay(entry.promptSnapshot)
            : 'No saved question yet. Solve this puzzle again to store its exact prompt.';
          const detailHints = entry.hintsSnapshot?.length ? entry.hintsSnapshot : [];

          return (
            <article
              key={entry.puzzleId}
              className={`artifact-row trophy-entry collection-card ${entry.solved ? 'solved' : 'attempted'} ${isExpanded ? 'expanded' : ''}`}
            >
              <button
                type="button"
                className="trophy-card-button"
                onClick={() => setExpandedMuseumPuzzleId((prev) => (prev === entry.puzzleId ? null : entry.puzzleId))}
                aria-expanded={isExpanded}
                aria-controls={`trophy-detail-${entry.puzzleId}`}
                aria-label={`View ${entry.title} puzzle question and hints`}
              >
                <div>
                  <strong>{getPuzzleEmoji({ id: entry.puzzleId, title: entry.title })} {entry.title}</strong>
                  {showAttemptedPuzzles && (
                    <p className="muted trophy-attempt-count">
                      {entry.attempts} {entry.attempts === 1 ? 'try' : 'tries'}
                    </p>
                  )}
                </div>
                <div className="artifact-meta trophy-visual">
                  <span className="trophy-icon" aria-hidden="true">{entry.solved ? '🏆' : '🛰️'}</span>
                  <div className="trophy-stars" aria-label={`Star progress ${entry.solved ? Math.min(3, 1 + entry.extensionsCompleted) : 0} of 3`}>
                    {Array.from({ length: 3 }).map((_, index) => {
                      const filled = entry.solved && index < Math.min(3, 1 + entry.extensionsCompleted);
                      return (
                        <span key={`${entry.puzzleId}-star-${index}`} className={`trophy-star ${filled ? 'filled' : ''}`} aria-hidden="true">
                          {filled ? '⭐' : '✩'}
                        </span>
                      );
                    })}
                  </div>
                  <span className="trophy-open-indicator" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
                </div>
              </button>

              {isExpanded && (
                <div id={`trophy-detail-${entry.puzzleId}`} className="trophy-detail">
                  <p className="trophy-detail-title">Puzzle Question</p>
                  <p className="trophy-detail-question">{detailQuestion}</p>
                  <p className="trophy-detail-title">Hints</p>
                  {detailHints.length > 0 ? (
                    <ol className="trophy-hint-list">
                      {detailHints.map((hint, index) => (
                        <li key={`${entry.puzzleId}-hint-${index}`}>{hint}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted trophy-detail-empty">No hints saved yet for this puzzle.</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </>
  );

  if (screen === 'landing') {
    return landing;
  }

  if (!state.user || screen === 'onboarding') {
    return onboarding;
  }

  return (
    <div className={`cosmic-root brand-${brandVariant}`}>
      <div className="parallax-bg bg-one" />
      {resultFlash && (
        <div className={`result-flash ${resultFlash.tone}`}>
          <div className="result-flash-card">
            <div className="result-flash-character">
              <CharacterAvatar characterId={state.user?.avatarId} size="lg" />
            </div>
            <p className="result-flash-icon">{resultFlash.icon}</p>
            <p className="result-flash-title">{resultFlash.title}</p>
            <p className="result-flash-detail">{resultFlash.detail}</p>
          </div>
        </div>
      )}

      <div className="app-container" ref={appContainerRef}>
        <header className="top-bar">
          <button
            type="button"
            className="app-brand-inline app-brand-button"
            onClick={() => setScreen('home')}
            aria-label="Go to Home"
            title="Go to Home"
          >
            <BrandMark size="sm" />
            <div className="app-brand-copy">
              <span className="app-brand-name">Galaxy Genius</span>
              {brandVariant === 'classic' && <span className="app-brand-tagline">Big Brains. Space Games.</span>}
            </div>
          </button>
          <div className="top-bar-tools">
            <div className="streak-counter" title="Score">⭐ {topBarPoints}</div>
          </div>
        </header>

        {screen === 'home' && home}
        {screen === 'run' && runView}
        {screen === 'summary' && summary}
        {screen === 'scores' && scores}
        {screen === 'museum' && museum}
      </div>

      {screen === 'run' && (
        <section className={`run-progress-dock ${hideBottomNav ? 'nav-hidden' : ''}`}>
          <div className="flow-progress-head">
            <p className="text-label">Orbit Progress</p>
            <span className="tag">{phaseLabel(run.phase)}</span>
          </div>
          <div className="flow-meter-wrap">
            <div className="flow-meter"><div className="flow-fill" style={{ width: `${Math.max(flowProgress, 6)}%` }} /></div>
          </div>
        </section>
      )}

      <nav className={`bottom-nav ${hideBottomNav ? 'is-hidden' : ''}`}>
        <button className={`nav-item ${screen === 'home' ? 'active' : ''}`} onClick={() => setScreen('home')} aria-label="Home">
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Home</span>
        </button>
        <button className={`nav-item ${screen === 'museum' ? 'active' : ''}`} onClick={() => setScreen('museum')} aria-label="Trophies">
          <span className="nav-icon">🏆</span>
          <span className="nav-label">Trophies</span>
        </button>
        <button className={`nav-item ${screen === 'scores' ? 'active' : ''}`} onClick={() => setScreen('scores')} aria-label="Stars">
          <span className="nav-icon">💫</span>
          <span className="nav-label">Stars</span>
        </button>
      </nav>
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { updateRating } from './lib/adaptive';
import { generateAdaptiveFlowItem } from './lib/flow-generator';
import { fetchLeaderboard, registerPlayer, upsertScore, type LeaderboardRow } from './lib/leaderboard-api';
import { generateAdaptivePuzzleChoices } from './lib/puzzle-generator';
import { loadState, saveState } from './lib/storage';
import { updateDailyStreak, updatePuzzleStreak } from './lib/streaks';
import type { AppState, FlowItem, PuzzleItem } from './lib/types';
import './styles.css';

type Screen = 'onboarding' | 'home' | 'run' | 'summary' | 'scores' | 'museum';
type FeedbackTone = 'success' | 'error' | 'info';
type CoachVisualRow = { label: string; value: number; detail: string; color: string };
type CoachVisualData = { kind?: 'bars' | 'fraction_line'; title: string; caption: string; rows: CoachVisualRow[]; guide?: string[] };
type DifficultyTier = 'Easy' | 'Medium' | 'Hard' | 'Expert' | 'Master';
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
  bossStage: 'intro' | 'question';
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
  flowStreak: number;
}

const FLOW_TARGET = 8;
const PUZZLE_TARGET = 3;
const FLOW_HINT_STEPS = 3;
const MAX_PUZZLE_HINTS = 2;

const playerCharacters: PlayerCharacter[] = [
  { id: 'astro-bot', emoji: '🤖', name: 'Astro Bot', vibe: 'Cheerful robot astronaut', kind: 'astronaut' },
  { id: 'animal-axo-naut', emoji: '🦎', name: 'Axo Naut', vibe: 'Coral pink explorer', kind: 'animal' },
  { id: 'animal-jelly-jet', emoji: '🪼', name: 'Jelly Jet', vibe: 'Floaty neon jellyfish', kind: 'animal' },
  { id: 'astro-cactus-cadet', emoji: '🌵', name: 'Cactus Comet', vibe: 'Spiky + silly', kind: 'astronaut' },
  { id: 'animal-stardust-fish', emoji: '⭐', name: 'Stardust Fish', vibe: 'Sparkly star swimmer', kind: 'animal' },
  { id: 'animal-cosmo-cat', emoji: '🐱', name: 'Cosmo Cat', vibe: 'Solar flares + mischief', kind: 'animal' }
];
const defaultCharacterId = playerCharacters[0].id;
const characterPaletteById: Record<string, { base: string; accent: string; trim: string; mark: string }> = {
  'astro-cactus-cadet': { base: '#d9f99d', accent: '#84cc16', trim: '#fef08a', mark: '#365314' },
  'astro-bot': { base: '#f8fafc', accent: '#60a5fa', trim: '#e2e8f0', mark: '#0f172a' },
  'animal-axo-naut': { base: '#f9a8d4', accent: '#fb7185', trim: '#fecdd3', mark: '#3f1d2e' },
  'animal-stardust-fish': { base: '#67e8f9', accent: '#06b6d4', trim: '#bae6fd', mark: '#0f172a' },
  'animal-jelly-jet': { base: '#c4b5fd', accent: '#7c3aed', trim: '#e9d5ff', mark: '#312e81' },
  'animal-cosmo-cat': { base: '#fdba74', accent: '#f59e0b', trim: '#fde68a', mark: '#7c2d12' }
};
const characterVariantById: Record<string, string> = {
  'astro-cactus-cadet': 'cactus-cadet',
  'astro-bot': 'astro-bot',
  'animal-axo-naut': 'axo-naut',
  'animal-stardust-fish': 'stardust-fish',
  'animal-jelly-jet': 'jelly-jet',
  'animal-cosmo-cat': 'cosmo-cat'
};

const fallbackLeaderboardRows: LeaderboardRow[] = [
  { rank: 1, userId: 'bot-astro', username: 'Astro', avatarId: 'astro-bot', score: 14200, updatedAt: '', isBot: true },
  { rank: 2, userId: 'bot-nova', username: 'Nova', avatarId: 'animal-axo-naut', score: 13780, updatedAt: '', isBot: true },
  { rank: 3, userId: 'bot-cyber', username: 'Cyber', avatarId: 'astro-cactus-cadet', score: 13040, updatedAt: '', isBot: true },
  { rank: 4, userId: 'bot-cometx', username: 'Comet_X', avatarId: 'animal-stardust-fish', score: 11900, updatedAt: '', isBot: true },
  { rank: 5, userId: 'bot-sputnik', username: 'Sputnik', avatarId: 'animal-jelly-jet', score: 10800, updatedAt: '', isBot: true }
];

const modeConfig: Record<GameMode, { name: string; icon: string; subtitle: string; flowTarget: number; puzzleTarget: number }> = {
  galaxy_mix: { name: 'Mission Mix', icon: '🪐', subtitle: 'Quick math + puzzles', flowTarget: FLOW_TARGET, puzzleTarget: PUZZLE_TARGET },
  rocket_rush: { name: 'Rocket Rush', icon: '🚀', subtitle: 'Fast math only', flowTarget: 12, puzzleTarget: 0 },
  puzzle_orbit: { name: 'Puzzle Planet', icon: '🧩', subtitle: 'Logic puzzles only', flowTarget: 0, puzzleTarget: 5 }
};

const bonusRound = {
  title: 'Fraction Fox',
  prompt: 'Which fraction is greater: 3/4 or 2/3?',
  choices: ['3/4', '2/3', 'Equal'],
  answer: '3/4',
  hint: 'Try twelfths: 3/4 = 9/12 and 2/3 = 8/12.'
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
  flowStreak: 0
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

const getTier = (difficulty: number): { label: DifficultyTier; icon: string; flowPoints: number; puzzlePoints: number } => {
  if (difficulty >= 1350) return { label: 'Master', icon: '🧭', flowPoints: 22, puzzlePoints: 66 };
  if (difficulty >= 1200) return { label: 'Expert', icon: '🎖️', flowPoints: 18, puzzlePoints: 54 };
  if (difficulty >= 1050) return { label: 'Hard', icon: '🚀', flowPoints: 15, puzzlePoints: 45 };
  if (difficulty >= 900) return { label: 'Medium', icon: '🛰️', flowPoints: 12, puzzlePoints: 36 };
  return { label: 'Easy', icon: '🧑‍🚀', flowPoints: 10, puzzlePoints: 30 };
};

const getPuzzleAnswerChoices = (answer: string): string[] | null => {
  const normalized = normalize(answer);
  if (normalized === 'yes' || normalized === 'no') return ['Yes', 'No'];
  if (normalized === 'always' || normalized === 'sometimes' || normalized === 'never') {
    return ['Always', 'Sometimes', 'Never'];
  }
  return null;
};

const getPuzzleInputMode = (puzzle: PuzzleItem): 'choice' | 'short_text' | 'long_text' => {
  if (puzzle.answer_type) return puzzle.answer_type;
  if (getPuzzleAnswerChoices(puzzle.core_answer)) return 'choice';
  return 'short_text';
};

const getPuzzlePlainLanguage = (puzzle: PuzzleItem): string => {
  const prompt = puzzle.core_prompt;
  const normalized = normalize(prompt);

  if (normalized.includes('for whole number n')) {
    const statement = prompt.replace(/for whole number n,\s*/i, '').trim();
    return `Pick if this statement is always true, sometimes true, or never true for counting numbers: ${statement}`;
  }

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

  return pickBySeed(['🛸', '🪐', '🌌', '☄️', '👾'], seed);
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
  if (item.tags.includes('ratios_rates')) return buildRatioVisual(text);
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
            <radialGradient id={shellId} cx="30%" cy="26%">
              <stop offset="0%" stopColor="#ecfeff" />
              <stop offset="48%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#0e7490" />
            </radialGradient>
          </defs>
          <path d="M50 10 L60 35 L86 35 L65 50 L73 76 L50 61 L27 76 L35 50 L14 35 L40 35 Z" fill={`url(#${shellId})`} />
          <path d="M50 19 L57 37 L77 37 L61 49 L67 68 L50 56 L33 68 L39 49 L23 37 L43 37 Z" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.5" />
          <circle cx="33" cy="32" r="6" fill="#67e8f9" fillOpacity="0.26" />
          <circle cx="67" cy="32" r="6" fill="#93c5fd" fillOpacity="0.24" />
          <circle cx="49" cy="58" r="1.2" fill="#fff" />
          <circle cx="56" cy="52" r="1.2" fill="#fff" />
          <circle cx="44" cy="52" r="1.2" fill="#fff" />
          <circle cx="42.2" cy="43" r="3.5" className="character-avatar-eye" fill="#0f172a" />
          <circle cx="57.8" cy="43" r="3.5" className="character-avatar-eye" fill="#0f172a" />
          <circle cx="43.3" cy="42" r="1.2" fill="#fff" />
          <circle cx="58.9" cy="42" r="1.2" fill="#fff" />
          <path d="M45 50 Q50 54 55 50" className="character-avatar-mouth" />
          <circle cx="38.6" cy="48.2" r="1.7" fill="#bae6fd" />
          <circle cx="61.4" cy="48.2" r="1.7" fill="#bae6fd" />
          <path d="M14 51 Q50 15 86 51" fill="none" stroke="rgba(186,230,253,0.62)" strokeWidth="1.3" />
          <circle cx="20" cy="47" r="1.15" className="character-avatar-star" />
          <circle cx="50" cy="16" r="1.25" className="character-avatar-star" />
          <circle cx="80" cy="47" r="1.15" className="character-avatar-star" />
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
            <radialGradient id={orbId} cx="34%" cy="30%">
              <stop offset="0%" stopColor="#ddd6fe" />
              <stop offset="45%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#7c3aed" />
            </radialGradient>
          </defs>
          <path d="M24 46 Q50 18 76 46 V62 Q50 76 24 62 Z" fill={`url(#${orbId})`} />
          <path d="M34 63 V84 M44 65 V88 M56 65 V88 M66 63 V84" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" />
          <circle cx="41" cy="47" r="6.4" fill="#f8fafc" />
          <circle cx="59" cy="47" r="6.4" fill="#f8fafc" />
          <circle cx="41" cy="47" r="2.5" className="character-avatar-eye" fill="#312e81" />
          <circle cx="59" cy="47" r="2.5" className="character-avatar-eye" fill="#312e81" />
          <path d="M45 57 Q50 62 55 57" className="character-avatar-mouth" />
          <circle cx="31" cy="39" r="2.2" fill="#e9d5ff" />
          <circle cx="69" cy="39" r="2.2" fill="#e9d5ff" />
          <circle cx="22" cy="31" r="1.1" className="character-avatar-star" />
          <circle cx="78" cy="33" r="1.1" className="character-avatar-star" />
          <polygon points="50,22 51.5,26 55.5,26 52.2,28.5 53.5,32.5 50,30.1 46.5,32.5 47.8,28.5 44.5,26 48.5,26" className="character-avatar-star" />
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

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [screen, setScreen] = useState<Screen>(() => (loadState().user ? 'home' : 'onboarding'));
  const [run, setRun] = useState<RunState>(newRun('galaxy_mix'));
  const [selectedMode, setSelectedMode] = useState<GameMode>('galaxy_mix');
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('info');
  const [resultPulse, setResultPulse] = useState<FeedbackTone | null>(null);
  const [resultFlash, setResultFlash] = useState<{ tone: FeedbackTone; title: string; detail: string; icon: string } | null>(null);
  const resultFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clarifyInput, setClarifyInput] = useState('');
  const [clarifyReply, setClarifyReply] = useState('');
  const [showTutor, setShowTutor] = useState(false);
  const [showClarifyDialog, setShowClarifyDialog] = useState(false);
  const [tutorStep, setTutorStep] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 700px)').matches : false
  );
  const [homeNavRevealed, setHomeNavRevealed] = useState(false);
  const appContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef(0);
  const lastSubmittedScoreRef = useRef(0);
  const [nameInput, setNameInput] = useState(() => loadState().user?.username ?? '');
  const [selectedCharacterId, setSelectedCharacterId] = useState(() => {
    const saved = loadState().user?.avatarId;
    if (saved) return getCharacterById(saved)?.id ?? defaultCharacterId;
    return '';
  });
  const [remoteLeaderboardRows, setRemoteLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [isRegisteringPlayer, setIsRegisteringPlayer] = useState(false);
  const [showAttemptedPuzzles, setShowAttemptedPuzzles] = useState(false);
  const [onboardingStage, setOnboardingStage] = useState<'name' | 'character'>(() => (loadState().user ? 'character' : 'name'));
  const explorerLevel = Math.floor(state.highs.bestTotal / 250) + 1;
  const selectedCharacter = getCharacterById(selectedCharacterId);
  const isEditingProfile = Boolean(state.user);
  const onboardingCadetName = nameInput.trim() || 'Cadet';
  const homeCadetName = state.user?.username ?? onboardingCadetName;
  const homeCharacterId = selectedCharacter?.id ?? state.user?.avatarId ?? defaultCharacterId;

  const totalScore = run.sprintScore + run.brainScore;
  const topBarPoints = screen === 'run' || screen === 'summary' ? totalScore : state.highs.bestTotal;
  const runTargetTotal = run.flowTarget + run.puzzleTarget;
  const runDoneTotal = run.flowDone + run.puzzleDone;
  const flowProgress = runTargetTotal ? Math.round((runDoneTotal / runTargetTotal) * 100) : 0;
  const hasCadetSnapshot = state.highs.bestTotal > 0 || state.streaks.dailyStreak > 0 || state.streaks.puzzleStreak > 0;

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

  useLayoutEffect(() => {
    resetScrollToTop();
    const rafId = window.requestAnimationFrame(() => resetScrollToTop());
    return () => window.cancelAnimationFrame(rafId);
  }, [screen]);

  useEffect(() => {
    let active = true;
    const loadLeaderboardRows = async () => {
      try {
        const rows = await fetchLeaderboard(50);
        if (active) setRemoteLeaderboardRows(rows);
      } catch {
        // Keep app usable with fallback rows when backend is unavailable.
      }
    };
    loadLeaderboardRows();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (screen !== 'scores') return;
    let active = true;
    const refreshLeaderboardRows = async () => {
      try {
        const rows = await fetchLeaderboard(50);
        if (active) setRemoteLeaderboardRows(rows);
      } catch {
        // Ignore transient backend failures; fallback rows still render.
      }
    };
    refreshLeaderboardRows();
    return () => {
      active = false;
    };
  }, [screen]);

  useEffect(() => {
    lastSubmittedScoreRef.current = 0;
  }, [state.user?.userId]);

  useEffect(() => {
    if (!state.user?.userId) return;
    const bestTotal = state.highs.bestTotal;
    if (bestTotal <= 0 || bestTotal <= lastSubmittedScoreRef.current) return;

    let cancelled = false;
    const syncScore = async () => {
      try {
        await upsertScore({
          userId: state.user!.userId!,
          username: state.user!.username,
          avatarId: state.user!.avatarId,
          score: bestTotal
        });
        if (cancelled) return;
        lastSubmittedScoreRef.current = bestTotal;
        const rows = await fetchLeaderboard(50);
        if (!cancelled) setRemoteLeaderboardRows(rows);
      } catch {
        // Best-effort sync; app still works offline.
      }
    };

    syncScore();
    return () => {
      cancelled = true;
    };
  }, [state.highs.bestTotal, state.user]);

  const getPuzzleChoices = (rating: number, usedPuzzleIds: Set<string>) =>
    generateAdaptivePuzzleChoices(rating, usedPuzzleIds, 2);

  const finishRun = (bossAttempted: boolean, runSnapshot: RunState = run) => {
    const brain = bossAttempted ? runSnapshot.brainScore * 2 : runSnapshot.brainScore;
    const total = runSnapshot.sprintScore + brain;

    const highs = {
      bestTotal: Math.max(state.highs.bestTotal, total),
      bestSprint: Math.max(state.highs.bestSprint, runSnapshot.sprintScore),
      bestBrain: Math.max(state.highs.bestBrain, brain)
    };

    save({ ...state, highs });
    setRun({ ...runSnapshot, brainScore: brain });
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
        seeded.recentShapes
      );
    }
    else seeded.currentPuzzleChoices = getPuzzleChoices(state.skill.rating, seeded.usedPuzzleIds);

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

    const updatedRating = updateRating(state.skill.rating, item.difficulty, correct, state.skill.attemptsCount);
    const tier = getTier(item.difficulty);
    const hintPenalty = run.currentHints * 3;
    const nextStreak = correct ? Math.min(run.flowStreak + 1, 5) : 0;
    const gain = correct ? Math.max(tier.flowPoints - hintPenalty, 4) : 0;

    save({
      ...state,
      skill: { rating: updatedRating, attemptsCount: state.skill.attemptsCount + 1 }
    });

    const usedFlowIds = new Set(run.usedFlowIds);
    usedFlowIds.add(item.id);
    const recentTemplates = [...run.recentTemplates, item.template].slice(-6);
    const recentShapes = [...run.recentShapes, item.shapeSignature].slice(-6);
    const nextFlowDone = run.flowDone + 1;

    if (nextFlowDone >= run.flowTarget) {
      if (run.puzzleTarget === 0) {
        const quickOnlyDone = {
          ...run,
          flowDone: nextFlowDone,
          sprintScore: run.sprintScore + gain,
          usedFlowIds,
          recentTemplates,
          recentShapes,
          currentHints: 0,
          currentFlow: undefined
        };
        finishRun(false, quickOnlyDone);
        return;
      }

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
        flowStreak: nextStreak,
        currentHints: 0
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

    const nextItem = generateAdaptiveFlowItem(
      updatedRating,
      usedFlowIds,
      item.difficulty,
      recentTemplates,
      recentShapes
    );
    setRun({
      ...run,
      flowDone: nextFlowDone,
      sprintScore: run.sprintScore + gain,
      usedFlowIds,
      recentTemplates,
      recentShapes,
      currentFlow: nextItem,
      flowStreak: nextStreak,
      currentHints: 0
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

    const streaks = updatePuzzleStreak(state.streaks, correct && !revealUsed);
    const museum = [...state.museum];
    const idx = museum.findIndex((entry) => entry.puzzleId === run.currentPuzzle?.id);
    const entry = {
      puzzleId: run.currentPuzzle.id,
      title: run.currentPuzzle.title,
      solved: correct,
      extensionsCompleted: correct ? (run.currentHints <= 1 ? 1 : 0) : 0,
      methodsFound: correct ? ['core-solved'] : []
    };

    if (idx >= 0) museum[idx] = { ...museum[idx], ...entry };
    else museum.push(entry);

    save({
      ...state,
      streaks,
      museum,
      skill: { rating: updatedRating, attemptsCount: state.skill.attemptsCount + 1 }
    });

    if (puzzleDone >= run.puzzleTarget) {
      if (run.gameMode !== 'galaxy_mix') {
        const puzzleOnlyDone = {
          ...run,
          brainScore: run.brainScore + gain,
          puzzleDone,
          usedPuzzleIds,
          currentHints: 0,
          currentPuzzle: undefined,
          currentPuzzleChoices: []
        };
        finishRun(false, puzzleOnlyDone);
        return;
      }

      setRun({
        ...run,
        brainScore: run.brainScore + gain,
        puzzleDone,
        usedPuzzleIds,
        phase: 'boss',
        bossStage: 'intro',
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

    setRun({
      ...run,
      brainScore: run.brainScore + gain,
      puzzleDone,
      usedPuzzleIds,
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
    setRun({ ...run, bossStage: 'question' as const });
    setInput('');
    setFeedback('Bonus challenge unlocked. Solve it to double puzzle points!');
    setFeedbackTone('info');
  };

  const submitBonusRound = () => {
    if (!input.trim()) return;
    const correct = isSmartAnswerMatch(input, [bonusRound.answer]);
    const snapshot: RunState = { ...run, bossStage: 'question' };
    finishRun(correct, snapshot);
  };

  const askPuzzleClarifyingQuestion = () => {
    if (!run.currentPuzzle || !clarifyInput.trim()) return;
    setClarifyReply(getClarifyingReply(run.currentPuzzle, clarifyInput, run.currentHints));
  };

  const getKidStrategyLine = (tags: string[]) => {
    if (tags.includes('mult_div')) return 'Think in equal groups.';
    if (tags.includes('fractions')) return 'Compare which piece is bigger.';
    if (tags.includes('equations')) return 'Undo one step at a time.';
    if (tags.includes('geometry_area')) return 'Use the area formula for the shape.';
    if (tags.includes('ratios_rates')) return 'Grow both sides the same way.';
    if (tags.includes('percents')) return 'Percent means out of 100.';
    if (tags.includes('counting')) return 'Try a smaller example first.';
    if (tags.includes('logic')) return 'Use clues and cross out wrong picks.';
    return 'Take it one small step at a time.';
  };

  const getFlowTutorSteps = (item: FlowItem) => {
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
        return [
          'Step 1: Area = length × width.',
          `Step 2: ${a}×${b} = ${item.answer}.`
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
        ? `Think: ${divisionMatch[2]} × ? = ${divisionMatch[1]}.`
        : 'Think: what number times the second number gives the first number?';
      return [
        'Step 1: Turn division into a multiplication fact.',
        `Step 2: ${divideHint}`,
        'Step 3: Use that number as your answer.'
      ];
    }

    const firstHint = item.hints[0] ? simplifyCoachLine(item.hints[0]) : 'Start with what you already know.';
    return [
      `Step 1: ${getKidStrategyLine(item.tags)}`,
      `Step 2: ${firstHint}`,
      'Step 3: Try your best answer. You can always adjust.'
    ];
  };

  const getPuzzleTutorSteps = (item: PuzzleItem) => {
    if (item.tags.includes('geometry_area')) {
      return [
        `Step 1: ${getGeometryCoachLine(item.core_prompt)}`,
        'Step 2: Give a short best guess and keep going.'
      ];
    }

    const firstHint = item.hint_ladder[0] ? simplifyCoachLine(item.hint_ladder[0]) : 'Break it into tiny parts.';
    return [
      `Step 1: ${getKidStrategyLine(item.tags)}`,
      `Step 2: ${firstHint}`,
      'Step 3: Give a short best guess and keep going.'
    ];
  };

  const completeOnboarding = async () => {
    const username = nameInput.trim();
    const chosenAvatarId = getCharacterById(selectedCharacterId)?.id ?? state.user?.avatarId;
    if (!username || !chosenAvatarId || isRegisteringPlayer) return;

    setIsRegisteringPlayer(true);
    try {
      const registered = await registerPlayer({
        userId: state.user?.userId,
        username,
        avatarId: chosenAvatarId
      });

      const nextState: AppState = {
        ...state,
        user: {
          userId: registered.userId,
          username: registered.username,
          avatarId: chosenAvatarId,
          createdAt: registered.createdAt
        }
      };
      save(nextState);
      setNameInput(registered.username);
      try {
        const rows = await fetchLeaderboard(50);
        setRemoteLeaderboardRows(rows);
      } catch {
        // Ignore refresh failures; retry happens when opening leaderboard.
      }
      setScreen('home');
    } catch {
      // Fallback to local save if backend is unavailable.
      save({
        ...state,
        user: {
          userId: state.user?.userId,
          username,
          avatarId: chosenAvatarId,
          createdAt: state.user?.createdAt ?? new Date().toISOString()
        }
      });
      setScreen('home');
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

  const museumRows = useMemo(
    () =>
      state.museum.map((entry) => ({ ...entry, title: toFriendlyPuzzleTitle(entry.title, entry.puzzleId) })),
    [state.museum]
  );
  const solvedRows = useMemo(() => museumRows.filter((entry) => entry.solved), [museumRows]);
  const collectionRows = showAttemptedPuzzles ? museumRows : solvedRows;

  const leaderboard = useMemo(() => {
    const youUserId = state.user?.userId;
    const youUsername = state.user?.username;
    const youAvatar = state.user?.avatarId ?? defaultCharacterId;
    const youScore = Math.max(state.highs.bestTotal, totalScore);

    const sourceRows = remoteLeaderboardRows.length
      ? remoteLeaderboardRows
      : [
          ...fallbackLeaderboardRows,
          { rank: 0, userId: youUserId ?? 'local-you', username: youUsername ?? 'You', avatarId: youAvatar, score: youScore, updatedAt: '' }
        ];

    return [...sourceRows]
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({
        rank: index + 1,
        name: entry.username,
        avatarId: entry.avatarId,
        score: entry.score,
        isYou: youUserId ? entry.userId === youUserId : entry.username === youUsername
      }));
  }, [remoteLeaderboardRows, state.highs.bestTotal, state.user, totalScore]);
  const podiumLeaders = useMemo(
    () =>
      [2, 1, 3]
        .map((rank) => leaderboard.find((entry) => entry.rank === rank))
        .filter((entry): entry is (typeof leaderboard)[number] => entry !== undefined),
    [leaderboard]
  );

  const runInProgress = screen === 'run' || run.flowDone > 0 || run.puzzleDone > 0 || run.phase !== 'flow' || Boolean(run.currentFlow);
  const hideBottomNav = isMobileViewport && (screen === 'home' || screen === 'run') && !homeNavRevealed;
  const showGamePhasesPanel = false;
  const currentFlowTutorSteps = run.currentFlow ? getFlowTutorSteps(run.currentFlow) : [];
  const currentPuzzleTutorSteps = run.currentPuzzle ? getPuzzleTutorSteps(run.currentPuzzle) : [];
  const currentFlowCoachVisual = run.currentFlow ? getCoachVisual(run.currentFlow) : null;
  const currentPuzzleCoachVisual = run.currentPuzzle ? getCoachVisual(run.currentPuzzle) : null;
  const navToRun = () => {
    if (runInProgress) {
      setScreen('run');
      return;
    }

    startRun(selectedMode);
  };

  const onboarding = (
    <div className="auth-shell">
      <div className="card onboarding-card">
        <div className="onboarding-brand">
          <span className="onboarding-brand-badge" aria-hidden="true">🪐</span>
          <div className="onboarding-brand-copy">
            <p className="onboarding-brand-name">GALAXY GENIUS</p>
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
                    className={`character-card ${selectedCharacterId === character.id ? 'selected' : ''}`}
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
          <p className="mission-brand-line">🪐 GALAXY GENIUS</p>
        </div>
        <span className="tag">Explorer Level {explorerLevel}</span>
      </section>

      <section className="card home-hero">
        <div className="home-hero-head">
          <div className="selected-player-avatar home-hero-avatar">
            <CharacterAvatar characterId={homeCharacterId} size="lg" />
          </div>
          <div className="home-hero-copy">
            <h3 className="home-hero-title">Ready for launch, {homeCadetName}?</h3>
          </div>
        </div>
      </section>

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

      {hasCadetSnapshot && (
        <>
          <section className="section-header player-title">
            <h3 className="text-title">Cadet Snapshot</h3>
          </section>

          <section className="stats-grid snapshot-grid">
            <div className="stat-card">
              <span className="stat-value accent">{state.streaks.dailyStreak}</span>
              <span className="stat-label">🔥 Day Streak</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{state.highs.bestTotal}</span>
              <span className="stat-label">⭐ Best Score</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{state.streaks.puzzleStreak}</span>
              <span className="stat-label">🧠 Puzzle Streak</span>
            </div>
          </section>
        </>
      )}
    </>
  );

  const runView = (
    <>
      <section className={`card run-main-card ${resultPulse ? `pulse-${resultPulse}` : ''}`}>
        {run.phase === 'flow' && run.currentFlow && (
          <>
            <div className="tier-row">
              <span className="tag difficulty-tag">{getTier(run.currentFlow.difficulty).icon} {getTier(run.currentFlow.difficulty).label}</span>
            </div>
            <h3 className="math-display"><InlineMathText text={run.currentFlow.prompt} /></h3>

            {run.currentFlow.choices && (
              <div className="chips">
                {run.currentFlow.choices.map((choice) => (
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
              {run.currentHints < Math.min(run.currentFlow.hints.length, FLOW_HINT_STEPS) && (
                <button
                  className="btn btn-secondary utility-btn"
                  onClick={() =>
                    setRun({
                      ...run,
                      currentHints: Math.min(
                        run.currentHints + 1,
                        Math.min(run.currentFlow?.hints.length ?? 0, FLOW_HINT_STEPS)
                      )
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
            <p className="puzzle-question-prompt"><InlineMathText text={run.currentPuzzle.core_prompt} /></p>
            {getPuzzleInputMode(run.currentPuzzle) === 'choice' ? (
              <div className="chips">
                {getPuzzleAnswerChoices(run.currentPuzzle.core_answer)?.map((choice) => (
                  <button
                    key={choice}
                    className={`btn btn-secondary chip-btn ${normalize(input) === normalize(choice) ? 'selected' : ''}`}
                    onClick={() => setInput(choice)}
                  >
                    <InlineMathText text={choice} />
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
              <button
                className="btn btn-secondary utility-btn"
                onClick={() => {
                  setShowClarifyDialog(true);
                  setShowTutor(false);
                }}
              >
                <span aria-hidden="true">❓</span> I have a question
              </button>
              {run.currentHints < MAX_PUZZLE_HINTS && (
                <button
                  className="btn btn-secondary utility-btn"
                  onClick={() => setRun({ ...run, currentHints: Math.min(run.currentHints + 1, MAX_PUZZLE_HINTS) })}
                >
                  <span aria-hidden="true">😉</span> Hint
                </button>
              )}
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

            <button className="btn btn-secondary" onClick={setupPuzzlePick}>Pick a Different Puzzle</button>
          </>
        )}

        {run.phase === 'boss' && (
          <>
            {run.bossStage === 'intro' ? (
              <>
                <h3>Bonus Round: {bonusRound.title}</h3>
                <p>Try it to double your puzzle points this game.</p>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={startBonusRound}>Play Bonus Round</button>
                  <button className="btn btn-secondary" onClick={() => finishRun(false)}>Finish Game</button>
                </div>
                <p className="muted">Bonus preview: {run.brainScore} → {run.brainScore * 2}</p>
              </>
            ) : (
              <>
                <h3>Bonus Round: {bonusRound.title}</h3>
                <p className="puzzle-question-prompt"><InlineMathText text={bonusRound.prompt} /></p>
                <div className="chips">
                  {bonusRound.choices.map((choice) => (
                    <button
                      key={choice}
                      className={`btn btn-secondary chip-btn ${normalize(input) === normalize(choice) ? 'selected' : ''}`}
                      onClick={() => setInput(choice)}
                    >
                      <InlineMathText text={choice} />
                    </button>
                  ))}
                </div>
                <input
                  className="math-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Your bonus answer"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitBonusRound();
                  }}
                />
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={submitBonusRound} disabled={!input.trim()}>
                    Submit Bonus Answer
                  </button>
                  <button className="btn btn-secondary" onClick={() => finishRun(false)}>
                    Skip Bonus
                  </button>
                </div>
                <p className="muted">{bonusRound.hint}</p>
              </>
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
            <span className="stat-value">{run.sprintScore + run.brainScore}</span>
            <span className="stat-label">Points</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{run.gameMode === 'rocket_rush' ? run.flowDone : run.puzzleDone}</span>
            <span className="stat-label">{run.gameMode === 'rocket_rush' ? 'Math solved' : 'Puzzle cards solved'}</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{state.highs.bestTotal}</span>
            <span className="stat-label">Best points</span>
          </div>
          <div className="stat-card">
            <span className="stat-value accent">{state.streaks.dailyStreak}</span>
            <span className="stat-label">Day streak</span>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => startRun(selectedMode)}>Play Again</button>
          <button className="btn btn-secondary" onClick={() => setScreen('scores')}>Star Board</button>
        </div>
      </section>
    </>
  );

  const scores = (
    <>
      <section className="section-header">
        <h2 className="text-title">Star Leaderboard</h2>
        <span className="tag">This Week</span>
      </section>

      <section className="card podium-wrap">
        {podiumLeaders.map((entry) => (
          <div key={entry.name} className={`podium-item rank-${entry.rank}`}>
            <div className="podium-avatar"><CharacterAvatar characterId={entry.avatarId} size="md" /></div>
            <strong>#{entry.rank}</strong>
            <span>{entry.name}</span>
            <small>{entry.score}</small>
          </div>
        ))}
      </section>

      <section className="list-container">
        {leaderboard.map((entry) => (
          <div key={`${entry.name}-${entry.rank}`} className={`rank-row ${entry.isYou ? 'me' : ''}`}>
            <span className="rank-number">{entry.rank}</span>
            <span className="row-avatar"><CharacterAvatar characterId={entry.avatarId} size="sm" /></span>
            <span className="row-name">{entry.name}</span>
            <span className="row-score">{entry.score}</span>
          </div>
        ))}
      </section>
    </>
  );

  const museum = (
    <>
      <section className="section-header">
        <h2 className="text-title">Trophy Galaxy</h2>
        <span className="tag">{solvedRows.length} solved</span>
      </section>

      <section className="card profile-hero collection-hero">
        <div className="pet-float"><CharacterAvatar characterId={state.user?.avatarId} size="lg" /></div>
        <h3>{state.user?.username}</h3>
        <p className="muted">This is your trophy shelf. Every solved puzzle earns a new space trophy.</p>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{solvedRows.length}</span>
          <span className="stat-label">Solved Puzzles</span>
        </div>
        <div className="stat-card">
          <span className="stat-value accent">{museumRows.length}</span>
          <span className="stat-label">Tried Puzzles</span>
        </div>
      </section>

      <section className="list-container">
        <div className="view-toggle">
          <button
            className={`btn btn-secondary chip-btn ${!showAttemptedPuzzles ? 'selected' : ''}`}
            onClick={() => setShowAttemptedPuzzles(false)}
          >
            Solved Only
          </button>
          <button
            className={`btn btn-secondary chip-btn ${showAttemptedPuzzles ? 'selected' : ''}`}
            onClick={() => setShowAttemptedPuzzles(true)}
          >
            Show Attempts
          </button>
        </div>
      </section>

      <section className="list-container">
        {collectionRows.length === 0 && !showAttemptedPuzzles && (
          <div className="empty-state">No solved puzzles yet. Solve a puzzle card to earn your first star.</div>
        )}
        {collectionRows.length === 0 && showAttemptedPuzzles && (
          <div className="empty-state">No puzzle attempts yet. Start a game and pick a puzzle card.</div>
        )}
        {collectionRows.map((entry) => (
          <div key={entry.puzzleId} className={`artifact-row collection-card ${entry.solved ? 'solved' : 'attempted'}`}>
            <div>
              <strong>{getPuzzleEmoji({ id: entry.puzzleId, title: entry.title })} {entry.title}</strong>
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
            </div>
          </div>
        ))}
      </section>
    </>
  );

  if (!state.user || screen === 'onboarding') {
    return onboarding;
  }

  return (
    <div className="cosmic-root">
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
          <div className="app-brand-inline" aria-label="Galaxy Genius">
            <span aria-hidden="true">🪐</span>
            <span>Galaxy Genius</span>
          </div>
          <div className="streak-counter" title="Score">⭐ {topBarPoints}</div>
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
        <button className={`nav-item ${screen === 'run' || screen === 'summary' ? 'active' : ''}`} onClick={navToRun} aria-label="Play">
          <span className="nav-icon">▶️</span>
          <span className="nav-label">Play</span>
        </button>
        <button className={`nav-item ${screen === 'museum' ? 'active' : ''}`} onClick={() => setScreen('museum')} aria-label="Trophies">
          <span className="nav-icon">🏆</span>
          <span className="nav-label">Trophies</span>
        </button>
        <button className={`nav-item ${screen === 'scores' ? 'active' : ''}`} onClick={() => setScreen('scores')} aria-label="Leaders">
          <span className="nav-icon">📊</span>
          <span className="nav-label">Leaders</span>
        </button>
      </nav>
    </div>
  );
}

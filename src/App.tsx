import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { updateRating } from './lib/adaptive';
import { generateAdaptiveFlowItem } from './lib/flow-generator';
import { generateAdaptivePuzzleChoices } from './lib/puzzle-generator';
import { loadState, saveState } from './lib/storage';
import { updateDailyStreak, updatePuzzleStreak } from './lib/streaks';
import type { AppState, FlowItem, PuzzleItem } from './lib/types';
import './styles.css';

type Screen = 'onboarding' | 'home' | 'run' | 'summary' | 'scores' | 'museum';
type FeedbackTone = 'success' | 'error' | 'info';
type CoachVisualRow = { label: string; value: number; detail: string; color: string };
type CoachVisualData = { kind?: 'bars' | 'fraction_line'; title: string; caption: string; rows: CoachVisualRow[]; guide?: string[] };
type DifficultyTier = 'Comet' | 'Rocket' | 'Supernova';
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
  flowStreak: number;
}

const FLOW_TARGET = 8;
const PUZZLE_TARGET = 3;
const MAX_HINTS_PER_QUESTION = 2;

const handles = ['CuriousComet42', 'PixelPanda77', 'OrbitOwl12', 'NovaNoodle55', 'LogicLynx31'];
const playerCharacters: PlayerCharacter[] = [
  { id: 'astro-starlight', emoji: '👩‍🚀', name: 'Starlight', vibe: 'Sparkly (feminine)', kind: 'astronaut' },
  { id: 'astro-comet', emoji: '👨‍🚀', name: 'Comet Ace', vibe: 'Classic (boyish)', kind: 'astronaut' },
  { id: 'astro-nebula', emoji: '🧑‍🚀', name: 'Nebula Nova', vibe: 'Neutral', kind: 'astronaut' },
  { id: 'astro-cadet', emoji: '🛸', name: 'Sky Cadet', vibe: 'Goofy', kind: 'astronaut' },
  { id: 'animal-space-fox', emoji: '🦊', name: 'Zippy Fox', vibe: 'Sneaky + zany', kind: 'animal' },
  { id: 'animal-cosmic-cat', emoji: '🐱', name: 'Captain Paws', vibe: 'Cute + clever', kind: 'animal' },
  { id: 'animal-octo-pilot', emoji: '🐙', name: 'Octo Pilot', vibe: 'Wacky', kind: 'animal' },
  { id: 'animal-panda-jet', emoji: '🐼', name: 'Panda Jet', vibe: 'Calm + funny', kind: 'animal' }
];
const defaultCharacterId = playerCharacters[0].id;
const characterPaletteById: Record<string, { base: string; accent: string; trim: string; mark: string }> = {
  'astro-starlight': { base: '#F9A8D4', accent: '#F472B6', trim: '#FDE68A', mark: '#1F2937' },
  'astro-comet': { base: '#93C5FD', accent: '#3B82F6', trim: '#E2E8F0', mark: '#0F172A' },
  'astro-nebula': { base: '#C4B5FD', accent: '#8B5CF6', trim: '#BAE6FD', mark: '#1E1B4B' },
  'astro-cadet': { base: '#67E8F9', accent: '#06B6D4', trim: '#86EFAC', mark: '#082F49' },
  'animal-space-fox': { base: '#FDBA74', accent: '#FB923C', trim: '#FDE68A', mark: '#431407' },
  'animal-cosmic-cat': { base: '#F9A8D4', accent: '#EC4899', trim: '#C4B5FD', mark: '#3F1D2E' },
  'animal-octo-pilot': { base: '#A78BFA', accent: '#7C3AED', trim: '#FBCFE8', mark: '#1E1B4B' },
  'animal-panda-jet': { base: '#E2E8F0', accent: '#94A3B8', trim: '#67E8F9', mark: '#020617' }
};
const characterVariantById: Record<string, string> = {
  'astro-starlight': 'astro-star',
  'astro-comet': 'astro-classic',
  'astro-nebula': 'astro-round',
  'astro-cadet': 'astro-goofy',
  'animal-space-fox': 'animal-fox',
  'animal-cosmic-cat': 'animal-cat',
  'animal-octo-pilot': 'animal-octo',
  'animal-panda-jet': 'animal-panda'
};

const leaderboardBots: Array<{ name: string; avatarId: string; score: number }> = [
  { name: 'Astro', avatarId: 'astro-comet', score: 14200 },
  { name: 'Nova', avatarId: 'astro-starlight', score: 13780 },
  { name: 'Cyber', avatarId: 'astro-cadet', score: 13040 },
  { name: 'Comet_X', avatarId: 'animal-space-fox', score: 11900 },
  { name: 'Sputnik', avatarId: 'animal-panda-jet', score: 10800 }
];

const modeConfig: Record<GameMode, { name: string; icon: string; subtitle: string; flowTarget: number; puzzleTarget: number }> = {
  galaxy_mix: { name: 'Mission Mix', icon: '🪐', subtitle: 'Quick math + puzzle cards', flowTarget: FLOW_TARGET, puzzleTarget: PUZZLE_TARGET },
  rocket_rush: { name: 'Rocket Rush', icon: '🚀', subtitle: 'Fast math only', flowTarget: 12, puzzleTarget: 0 },
  puzzle_orbit: { name: 'Puzzle Planet', icon: '🧩', subtitle: 'Logic puzzle cards only', flowTarget: 0, puzzleTarget: 5 }
};

const newRun = (mode: GameMode = 'galaxy_mix'): RunState => ({
  phase: modeConfig[mode].flowTarget > 0 ? 'flow' : 'puzzle_pick',
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

const getTier = (difficulty: number): { label: DifficultyTier; icon: string; flowPoints: number; puzzlePoints: number } => {
  if (difficulty >= 1250) return { label: 'Supernova', icon: '🌟', flowPoints: 20, puzzlePoints: 60 };
  if (difficulty >= 1000) return { label: 'Rocket', icon: '🚀', flowPoints: 15, puzzlePoints: 45 };
  return { label: 'Comet', icon: '☄️', flowPoints: 10, puzzlePoints: 30 };
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

const getCharacterById = (characterId?: string) => playerCharacters.find((character) => character.id === characterId);

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

const CharacterAvatar = ({ characterId, size = 'md' }: { characterId?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) => {
  const character = getCharacterById(characterId);
  const variant = characterVariantById[character?.id ?? ''] ?? 'astro-classic';
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
      <span className="character-avatar-head">
        <span className="character-avatar-face">
          <span className="character-avatar-eye" />
          <span className="character-avatar-eye" />
        </span>
        <span className="character-avatar-mouth" />
        <span className="character-avatar-feature feature-a" />
        <span className="character-avatar-feature feature-b" />
        <span className="character-avatar-blush" />
      </span>
      <span className="character-avatar-body">
        <span className="character-avatar-belly" />
        <span className="character-avatar-feature body-feature" />
      </span>
      <span className="character-avatar-feet">
        <span className="character-avatar-foot" />
        <span className="character-avatar-foot" />
      </span>
      <span className="character-avatar-accent" />
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
  const [nameInput, setNameInput] = useState(() => loadState().user?.username ?? '');
  const [selectedCharacterId, setSelectedCharacterId] = useState(() => {
    const saved = loadState().user?.avatarId;
    return getCharacterById(saved)?.id ?? defaultCharacterId;
  });
  const [showAttemptedPuzzles, setShowAttemptedPuzzles] = useState(false);
  const explorerLevel = Math.floor(state.highs.bestTotal / 250) + 1;
  const selectedCharacter = getCharacterById(selectedCharacterId) ?? playerCharacters[0];
  const selectedModeConfig = modeConfig[selectedMode];

  const totalScore = run.sprintScore + run.brainScore;
  const topBarPoints = screen === 'run' || screen === 'summary' ? totalScore : state.highs.bestTotal;
  const runTargetTotal = run.flowTarget + run.puzzleTarget;
  const runDoneTotal = run.flowDone + run.puzzleDone;
  const flowProgress = runTargetTotal ? Math.round((runDoneTotal / runTargetTotal) * 100) : 0;
  const puzzleSolveRate = state.museum.length
    ? Math.round((state.museum.filter((entry) => entry.solved).length / state.museum.length) * 100)
    : 0;

  const save = (next: AppState) => {
    setState(next);
    saveState(next);
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
    if (seeded.flowTarget > 0) seeded.currentFlow = generateAdaptiveFlowItem(state.skill.rating, seeded.usedFlowIds);
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
    const hintPenalty = run.currentHints === 0 ? 0 : run.currentHints === 1 ? 3 : 6;
    const nextStreak = correct ? Math.min(run.flowStreak + 1, 5) : 0;
    const gain = correct ? Math.max(tier.flowPoints - hintPenalty, 4) : 0;

    save({
      ...state,
      skill: { rating: updatedRating, attemptsCount: state.skill.attemptsCount + 1 }
    });

    const usedFlowIds = new Set(run.usedFlowIds);
    usedFlowIds.add(item.id);
    const nextFlowDone = run.flowDone + 1;

    if (nextFlowDone >= run.flowTarget) {
      if (run.puzzleTarget === 0) {
        const quickOnlyDone = {
          ...run,
          flowDone: nextFlowDone,
          sprintScore: run.sprintScore + gain,
          usedFlowIds,
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

    const nextItem = generateAdaptiveFlowItem(updatedRating, usedFlowIds, item.difficulty);
    setRun({
      ...run,
      flowDone: nextFlowDone,
      sprintScore: run.sprintScore + gain,
      usedFlowIds,
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
    const revealUsed = run.currentHints >= MAX_HINTS_PER_QUESTION;
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

  const completeOnboarding = () => {
    const username = nameInput.trim();
    if (!username) return;

    save({
      ...state,
      user: {
        username,
        avatarId: selectedCharacterId,
        createdAt: state.user?.createdAt ?? new Date().toISOString()
      }
    });

    setScreen('home');
  };

  const museumRows = useMemo(
    () =>
      state.museum.map((entry) => ({ ...entry, title: toFriendlyPuzzleTitle(entry.title, entry.puzzleId) })),
    [state.museum]
  );
  const solvedRows = useMemo(() => museumRows.filter((entry) => entry.solved), [museumRows]);
  const collectionRows = showAttemptedPuzzles ? museumRows : solvedRows;

  const leaderboard = useMemo(() => {
    const you = state.user?.username ?? 'You';
    const yourScore = Math.max(state.highs.bestTotal, totalScore);
    const board = [
      ...leaderboardBots.map((bot) => ({ name: bot.name, avatarId: bot.avatarId, score: bot.score, isYou: false })),
      { name: `${you} (You)`, avatarId: state.user?.avatarId ?? defaultCharacterId, score: yourScore, isYou: true }
    ];

    return board.sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1 }));
  }, [state.highs.bestTotal, state.user, totalScore]);

  const runInProgress = screen === 'run' || run.flowDone > 0 || run.puzzleDone > 0 || run.phase !== 'flow' || Boolean(run.currentFlow);
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
        <h1>{state.user ? 'Edit Your Player' : 'Choose Your Player'}</h1>
        <p className="muted">Pick your name and your space buddy.</p>

        <input
          className="math-input"
          placeholder="Player name"
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') completeOnboarding();
          }}
        />

        <div className="chips">
          {handles.map((handle) => (
            <button key={handle} className="btn btn-secondary chip-btn" onClick={() => setNameInput(handle)}>
              {handle}
            </button>
          ))}
        </div>

        <div className="character-section">
          <p className="text-label">Astronaut Crew</p>
          <div className="character-grid">
            {playerCharacters
              .filter((character) => character.kind === 'astronaut')
              .map((character) => (
                <button
                  key={character.id}
                  className={`character-card ${selectedCharacterId === character.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCharacterId(character.id)}
                >
                  <div className="character-card-head">
                    <CharacterAvatar characterId={character.id} size="lg" />
                  </div>
                  <span className="character-name">{character.name}</span>
                </button>
              ))}
          </div>
        </div>

        <div className="character-section">
          <p className="text-label">Zany Animal Crew</p>
          <div className="character-grid">
            {playerCharacters
              .filter((character) => character.kind === 'animal')
              .map((character) => (
                <button
                  key={character.id}
                  className={`character-card ${selectedCharacterId === character.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCharacterId(character.id)}
                >
                  <div className="character-card-head">
                    <CharacterAvatar characterId={character.id} size="lg" />
                  </div>
                  <span className="character-name">{character.name}</span>
                </button>
              ))}
          </div>
        </div>

        <p className="muted selected-player-row">Selected: <CharacterAvatar characterId={selectedCharacter.id} size="sm" /> {selectedCharacter.name}</p>

        <div className="btn-row">
          <button className="btn btn-primary" disabled={!nameInput.trim()} onClick={completeOnboarding}>
            {state.user ? 'Save Player' : 'Start Playing'}
          </button>
          {state.user && (
            <button className="btn btn-secondary" onClick={() => setScreen('home')}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const home = (
    <>
      <section className="section-header">
        <h2 className="text-title">Home Base</h2>
        <span className="tag">Explorer Level {explorerLevel}</span>
      </section>

      <section className="card">
        <p className="muted">Pick your space adventure:</p>
        <div className="mode-card-grid">
          {(Object.keys(modeConfig) as GameMode[]).map((mode) => (
            <button
              key={mode}
              className={`mode-card-option ${selectedMode === mode ? 'selected' : ''}`}
              onClick={() => setSelectedMode(mode)}
            >
              <span className="mode-card-title">{modeConfig[mode].icon} {modeConfig[mode].name}</span>
              <span className="mode-card-subtitle">{modeConfig[mode].subtitle}</span>
              <span className="mode-card-meta">
                {modeConfig[mode].flowTarget > 0 ? `${modeConfig[mode].flowTarget} quick` : '0 quick'} · {modeConfig[mode].puzzleTarget} puzzles
              </span>
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => startRun(selectedMode)}>
            {runInProgress ? `New ${selectedModeConfig.name}` : `Start ${selectedModeConfig.name}`}
          </button>
          {runInProgress && (
            <button className="btn btn-secondary" onClick={() => setScreen('run')}>
              Keep Playing
            </button>
          )}
        </div>
      </section>

      <section className="stats-grid">
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
          <span className="stat-label">🧠 Puzzle Solve</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{state.museum.length}</span>
          <span className="stat-label">🏆 Trophies</span>
        </div>
      </section>
    </>
  );

  const runView = (
    <>
      <section className="section-header">
        <h2 className="text-title">Game Time</h2>
        <span className="tag">{phaseLabel(run.phase)}</span>
      </section>

      <div className="flow-meter-wrap">
        <div className="flow-meter"><div className="flow-fill" style={{ width: `${Math.max(flowProgress, 6)}%` }} /></div>
      </div>

      <section className={`card ${resultPulse ? `pulse-${resultPulse}` : ''}`}>
        {run.phase === 'flow' && run.currentFlow && (
          <>
            <div className="tier-row">
              <span className="tag">{getTier(run.currentFlow.difficulty).icon} {getTier(run.currentFlow.difficulty).label}</span>
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
              {run.currentHints < Math.min(run.currentFlow.hints.length, MAX_HINTS_PER_QUESTION) && (
                <button
                  className="btn btn-secondary utility-btn"
                  onClick={() =>
                    setRun({
                      ...run,
                      currentHints: Math.min(
                        run.currentHints + 1,
                        Math.min(run.currentFlow?.hints.length ?? 0, MAX_HINTS_PER_QUESTION)
                      )
                    })
                  }
                >
                  <span aria-hidden="true">😉</span> Hint
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
                  <span className="emoji">🛸</span>
                  <strong>{puzzle.title}</strong>
                  <span className="muted">{getTier(puzzle.difficulty).icon} {getTier(puzzle.difficulty).label}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={setupPuzzlePick}>Shuffle Cards</button>
          </>
        )}

        {run.phase === 'puzzle' && run.currentPuzzle && (
          <>
            <div className="tier-row">
              <span className="tag">{getTier(run.currentPuzzle.difficulty).icon} {getTier(run.currentPuzzle.difficulty).label}</span>
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
              {run.currentHints < MAX_HINTS_PER_QUESTION && (
                <button
                  className="btn btn-secondary utility-btn"
                  onClick={() => setRun({ ...run, currentHints: Math.min(run.currentHints + 1, MAX_HINTS_PER_QUESTION) })}
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
            <h3>Bonus Round: Fraction Fox</h3>
            <p>Try it to double your puzzle points this game.</p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => finishRun(true)}>Play Bonus Round</button>
              <button className="btn btn-secondary" onClick={() => finishRun(false)}>Finish Game</button>
            </div>
            <p className="muted">Bonus preview: {run.brainScore} → {run.brainScore * 2}</p>
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
        {leaderboard.slice(0, 3).map((entry) => (
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
              <strong>{entry.title}</strong>
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
            <p className="result-flash-icon">{resultFlash.icon}</p>
            <p className="result-flash-title">{resultFlash.title}</p>
            <p className="result-flash-detail">{resultFlash.detail}</p>
          </div>
        </div>
      )}

      <div className="app-container">
        <header className="top-bar">
          <button className="user-pill user-pill-button" onClick={() => setScreen('onboarding')}>
            <CharacterAvatar characterId={state.user.avatarId} size="xs" />
            <span className="text-label profile-pill-name">{state.user.username}</span>
          </button>
          <div className="streak-counter">⭐ {topBarPoints}</div>
        </header>

        {screen === 'home' && home}
        {screen === 'run' && runView}
        {screen === 'summary' && summary}
        {screen === 'scores' && scores}
        {screen === 'museum' && museum}
      </div>

      <nav className="bottom-nav">
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

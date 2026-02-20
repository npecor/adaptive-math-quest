import { chooseTargetDifficulty } from './adaptive';
import type { PuzzleItem } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(items: T[]): T => items[randInt(0, items.length - 1)];
const hasDecimal = (text: string) => /\d+\.\d+/.test(text);
const bannedAlgebraNotation = /\bn\b|n\^2|n²|n\(\s*n\s*[\+\-]\s*1\s*\)|n\(\s*n\s*-\s*1\s*\)|n\(\s*n\s*\+\s*1\s*\)/i;

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
  const pairTheme = pick(['Comet Crew', 'Meteor Mates', 'Nebula Buddies', 'Star Squad']);
  return {
    signature: `pairs-${n}`,
    tags: ['counting', 'logic'],
    title: `${pairTheme} High-Fives (${n})`,
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
    extensions: extensions('How many with 12 cadets?', 'Write a rule for any number of cadets.')
  };
};

const factorPairs = (n: number): Array<[number, number]> => {
  const pairs: Array<[number, number]> = [];
  for (let a = 2; a * a <= n; a += 1) {
    if (n % a === 0) pairs.push([a, n / a]);
  }
  return pairs;
};

const yesNoAreaPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  let side = randInt(4, 18);
  let squareArea = side * side;
  let nonSquarePairs = factorPairs(squareArea).filter(([x, y]) => !(x === side && y === side));
  // Some square areas only have one non-trivial pair (e.g. 7x7). Re-roll until we get a real rectangle.
  for (let tries = 0; tries < 20 && nonSquarePairs.length === 0; tries += 1) {
    side = randInt(4, 18);
    squareArea = side * side;
    nonSquarePairs = factorPairs(squareArea).filter(([x, y]) => !(x === side && y === side));
  }
  if (nonSquarePairs.length === 0) {
    side = 12;
    squareArea = side * side;
    nonSquarePairs = factorPairs(squareArea).filter(([x, y]) => !(x === side && y === side));
  }

  const isYes = Math.random() < 0.55;
  let a = side;
  let b = side;

  if (isYes) {
    const pickPair = pick(nonSquarePairs);
    a = pickPair[0];
    b = pickPair[1];
  } else {
    const target = squareArea;
    const candidates: Array<[number, number]> = [];
    for (let x = 2; x <= 24; x += 1) {
      for (let y = 2; y <= 24; y += 1) {
        const area = x * y;
        if (area !== target && Math.abs(area - target) <= Math.max(18, Math.floor(target * 0.25))) {
          candidates.push([x, y]);
        }
      }
    }
    const chosen = candidates.length ? pick(candidates) : [side + 1, side];
    a = chosen[0];
    b = chosen[1];
  }

  const rectArea = a * b;
  const answer: 'Yes' | 'No' = rectArea === squareArea ? 'Yes' : 'No';
  return {
    signature: `area_yn-${side}-${a}-${b}-${answer.toLowerCase()}`,
    tags: ['spatial', 'reasoning', 'geometry_area'],
    title: 'Shape Warp: Area Check',
    answer_type: 'choice',
    choices: ['Yes', 'No'],
    core_prompt: `Can a ${side}×${side} square become a ${a}×${b} rectangle (no stretching)?`,
    core_answer: answer,
    hint_ladder: [
      `Find the square’s area: ${side}×${side}.`,
      `Find the rectangle’s area: ${a}×${b}.`,
      'No stretching means the area must stay the same.',
      `Compare: ${squareArea} vs ${rectArea}.`
    ],
    solution_steps: [
      `Square area = ${side}×${side} = ${squareArea}.`,
      `Rectangle area = ${a}×${b} = ${rectArea}.`,
      'No stretching means area must stay the same.',
      answer === 'Yes' ? 'Areas match -> Yes.' : 'Areas do not match -> No.'
    ],
    extensions: extensions('Make your own Yes example.', 'Make your own No example.')
  };
};

const switchPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const missionCode = randInt(100, 999);
  const missionName = pick(['Light Lab', 'Lamp Link', 'Switch Secret', 'Glow Guide']);
  return {
    signature: `switch-${missionCode}`,
    tags: ['logic', 'strategy'],
    title: `${missionName} #${missionCode}`,
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

type StarsVariant = {
  slug: string;
  title: string;
  n: number;
  takeMax: 3;
};

const STARS_VARIANTS: StarsVariant[] = [
  { slug: 'n-8', title: 'Star Grab: 8 Stars', n: 8, takeMax: 3 },
  { slug: 'n-9', title: 'Star Grab: 9 Stars', n: 9, takeMax: 3 },
  { slug: 'n-10', title: 'Star Grab: 10 Stars', n: 10, takeMax: 3 },
  { slug: 'n-11', title: 'Star Grab: 11 Stars', n: 11, takeMax: 3 },
  { slug: 'n-12', title: 'Star Grab: 12 Stars', n: 12, takeMax: 3 },
  { slug: 'n-13', title: 'Star Grab: 13 Stars', n: 13, takeMax: 3 },
  { slug: 'n-14', title: 'Star Grab: 14 Stars', n: 14, takeMax: 3 },
  { slug: 'n-15', title: 'Star Grab: 15 Stars', n: 15, takeMax: 3 },
  { slug: 'n-16', title: 'Star Grab: 16 Stars', n: 16, takeMax: 3 },
  { slug: 'n-18', title: 'Star Grab: 18 Stars', n: 18, takeMax: 3 }
];

const starsStrategyPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const v = pick(STARS_VARIANTS);
  const n = v.n;
  const answer: 'Yes' | 'No' = n % 4 === 0 ? 'No' : 'Yes';
  const winningMove = n % 4 === 0 ? null : n % 4;

  return {
    signature: `${n}-${v.slug}`,
    tags: ['strategy', 'pattern', 'logic'],
    title: v.title,
    answer_type: 'choice',
    choices: ['Yes', 'No'],
    core_prompt: `There are ${n} stars. You go first. Each turn you may take 1, 2, or 3 stars. Whoever takes the last star wins. Do you have a winning strategy?`,
    core_answer: answer,
    hint_ladder: [
      'Try tiny games first: 1, 2, 3, 4 stars.',
      'Find bad starting numbers where the first player loses.',
      'Notice a pattern: 4, 8, 12, 16...',
      'Try to leave a multiple of 4 after your move.'
    ],
    solution_steps: [
      'With 4 stars, the first player loses (whatever you take, the other player takes the rest).',
      'That makes 4 a bad number to start on.',
      'Every multiple of 4 is bad if both players play perfectly.',
      winningMove
        ? `Since ${n} is not a multiple of 4, take ${winningMove} first to leave ${n - winningMove} (a multiple of 4).`
        : `Since ${n} is a multiple of 4, the other player can always respond to keep multiples of 4.`,
      `Answer: ${answer}.`
    ],
    extensions: extensions('Try the same game with 20 stars.', 'What if you can take 1 to 4 instead?')
  };
};

type LogicVariant = {
  slug: string;
  title: string;
  prompt: string;
  answerType: PuzzleItem['answer_type'];
  answer: string;
  choices?: string[];
  accept?: string[];
  hints: string[];
  steps: string[];
};

const LOGIC_VARIANTS: LogicVariant[] = [
  {
    slug: 'two-airlocks',
    title: 'Two Airlocks',
    prompt: 'Two airlocks: one is SAFE, one is TRAP.\n\nSign on Airlock 1: "Airlock 2 is SAFE."\nSign on Airlock 2: "Airlock 1 is TRAP."\n\nExactly ONE sign is true.\nWhich airlock is SAFE?',
    answerType: 'choice',
    choices: ['Airlock 1', 'Airlock 2'],
    answer: 'Airlock 2',
    hints: [
      'Try assuming Airlock 1 is safe, then check both signs.',
      'You need exactly ONE sign to be true.',
      'If you get 0 true signs or 2 true signs, that case is wrong.',
      'Try the other airlock.'
    ],
    steps: [
      'Assume Airlock 1 is SAFE -> Airlock 2 is TRAP.',
      'Sign 1 says "Airlock 2 is SAFE." That would be false.',
      'Sign 2 says "Airlock 1 is TRAP." That would be false.',
      'That is 0 true signs, but we need exactly 1 -> impossible.',
      'So Airlock 1 is not safe -> Airlock 2 is SAFE.',
      'Answer: Airlock 2.'
    ]
  },
  {
    slug: 'robot-buttons',
    title: 'Robot Buttons',
    prompt: 'A robot has 3 buttons: ZAP, BOOP, BEEP.\nExactly ONE button gives a candy.\nYou press ZAP and get NO candy.\nWhich buttons could still give candy?',
    answerType: 'short_text',
    answer: 'BOOP or BEEP',
    accept: ['boop or beep', 'boop and beep', 'boop, beep', 'BOOP or BEEP', 'BOOP and BEEP'],
    hints: ['ZAP did not work.', 'So it is not ZAP.', 'That leaves two possibilities.', 'Name both.'],
    steps: [
      'Only one button works.',
      'ZAP failed, so ZAP is not the candy button.',
      'So it must be BOOP or BEEP.',
      'Answer: BOOP or BEEP.'
    ]
  },
  {
    slug: 'planet-prime',
    title: 'Planet Prime',
    prompt: 'Which number does NOT belong? 2, 3, 5, 9',
    answerType: 'short_text',
    answer: '9',
    accept: ['9', 'nine', 'Nine'],
    hints: [
      'Three of these are prime numbers.',
      'Prime means: only 1 and itself are factors.',
      '2, 3, and 5 are prime.',
      '9 is not prime (3x3).'
    ],
    steps: ['2, 3, and 5 are prime.', '9 = 3x3, so it has more factors.', 'So 9 does not belong.', 'Answer: 9.']
  },
  {
    slug: 'even-meteor',
    title: 'Even Meteor',
    prompt: 'Pick the expression that is ALWAYS even:\nA) odd + odd\nB) odd + even\nC) odd x odd',
    answerType: 'choice',
    choices: ['A) odd + odd', 'B) odd + even', 'C) odd x odd'],
    answer: 'A) odd + odd',
    hints: ['Try small examples.', '3+5 = 8 (even).', '3+4 = 7 (odd).', '3x5 = 15 (odd).'],
    steps: ['Odd + odd is always even.', 'Odd + even is always odd.', 'Odd x odd is always odd.', 'Answer: A) odd + odd.']
  },
  {
    slug: 'stardust-estimate',
    title: 'Stardust Estimate',
    prompt: 'Which is closest to 51 + 49?\nA) 80\nB) 100\nC) 120',
    answerType: 'choice',
    choices: ['A) 80', 'B) 100', 'C) 120'],
    answer: 'B) 100',
    hints: ['51 is close to 50.', '49 is close to 50.', '50 + 50 = 100.', 'So 100 is closest.'],
    steps: ['Round 51 -> 50 and 49 -> 50.', '50 + 50 = 100.', 'Answer: B) 100.']
  },
  {
    slug: 'orbit-pattern',
    title: 'Orbit Pattern',
    prompt: 'Fill in the blank: 3, 6, 12, __, 48',
    answerType: 'short_text',
    answer: '24',
    accept: ['24', 'twenty four', 'twenty-four'],
    hints: ['Look at how each number changes.', 'Each step doubles.', '12 x 2 = 24.', 'Then 24 x 2 = 48.'],
    steps: ['Pattern is x2 each step.', '12 x 2 = 24.', 'Answer: 24.']
  },
  {
    slug: 'rocket-code',
    title: 'Rocket Code',
    prompt: 'Code rule: A=1, B=2, C=3...\nWhat is the code value of CAB?',
    answerType: 'short_text',
    answer: '6',
    accept: ['6', 'six'],
    hints: ['C = 3, A = 1, B = 2.', 'Add them.', '3 + 1 + 2 = 6.', 'So the code is 6.'],
    steps: ['Convert letters to numbers.', 'C + A + B = 3 + 1 + 2 = 6.', 'Answer: 6.']
  },
  {
    slug: 'meteor-balance',
    title: 'Meteor Balance',
    prompt: 'Which is heavier?\nA) 2 kg + 600 g\nB) 2 kg + 500 g',
    answerType: 'choice',
    choices: ['A) 2 kg + 600 g', 'B) 2 kg + 500 g'],
    answer: 'A) 2 kg + 600 g',
    hints: ['Both have 2 kg.', 'Compare only grams.', '600 g is more than 500 g.', 'So A is heavier.'],
    steps: ['Both options share 2 kg.', '600 g > 500 g.', 'Answer: A) 2 kg + 600 g.']
  },
  {
    slug: 'moon-fractions',
    title: 'Moon Fractions',
    prompt: 'Which is bigger?\nA) 1/2\nB) 3/8',
    answerType: 'choice',
    choices: ['A) 1/2', 'B) 3/8'],
    answer: 'A) 1/2',
    hints: ['Use eighths.', '1/2 = 4/8.', '4/8 is bigger than 3/8.', 'So A is bigger.'],
    steps: ['Convert 1/2 to 4/8.', 'Compare 4/8 and 3/8.', 'Answer: A) 1/2.']
  },
  {
    slug: 'alien-train',
    title: 'Alien Train',
    prompt: 'A train leaves every 5 minutes.\nIf one left at 3:00, when does the 4th train leave?',
    answerType: 'short_text',
    answer: '3:15',
    accept: ['315', '3 15', '3:15 pm', '3:15'],
    hints: ['Count trains: 1st at 3:00.', '2nd at 3:05, 3rd at 3:10.', '4th is 5 minutes later.', 'So it is 3:15.'],
    steps: ['Starts at 3:00.', 'After three 5-minute jumps: 3:15.', 'Answer: 3:15.']
  }
];

const miniLogicPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const v = pick(LOGIC_VARIANTS);
  return {
    signature: `logic-${v.slug}`,
    tags: ['logic', 'reasoning'],
    title: v.title,
    answer_type: v.answerType,
    core_prompt: v.prompt,
    core_answer: v.answer,
    ...(v.choices ? { choices: v.choices } : {}),
    ...(v.accept ? { accept_answers: v.accept } : {}),
    hint_ladder: [...v.hints],
    solution_steps: [...v.steps],
    extensions: extensions('Try making your own version.', 'Explain your reasoning in one sentence.')
  };
};

const templates: PuzzleTemplate[] = [
  { key: 'pairs', minDifficulty: 900, maxDifficulty: 1150, build: () => pairCountPuzzle() },
  { key: 'area_yn', minDifficulty: 900, maxDifficulty: 1400, build: () => yesNoAreaPuzzle() },
  { key: 'stars', minDifficulty: 980, maxDifficulty: 1500, build: () => starsStrategyPuzzle() },
  { key: 'logic', minDifficulty: 900, maxDifficulty: 1500, build: () => miniLogicPuzzle() },
  { key: 'switch', minDifficulty: 1280, maxDifficulty: 1700, build: () => switchPuzzle() }
];

const pickTemplate = (difficulty: number): PuzzleTemplate => {
  const eligible = templates.filter((template) => difficulty >= template.minDifficulty - 80 && difficulty <= template.maxDifficulty + 80);
  return eligible.length ? pick(eligible) : templates[0];
};

const isKidSafePuzzle = (candidate: PuzzleItem): boolean => {
  const textFields = [candidate.title, candidate.core_prompt, candidate.core_answer, ...(candidate.hint_ladder ?? []), ...(candidate.solution_steps ?? [])];
  if (textFields.some((text) => bannedAlgebraNotation.test(text))) return false;
  if (candidate.id.startsWith('area_yn-') && textFields.some((text) => hasDecimal(text))) return false;
  return true;
};

const buildCandidate = (targetDifficulty: number): PuzzleItem => {
  for (let attempts = 0; attempts < 14; attempts += 1) {
    const difficulty = clamp(Math.round(targetDifficulty + randInt(-60, 60)), 900, 1700);
    const template = pickTemplate(difficulty);
    const built = template.build(difficulty);
    const candidate: PuzzleItem = {
      id: `${template.key}-${built.signature}`,
      type: 'puzzle',
      difficulty,
      ...built
    };
    if (isKidSafePuzzle(candidate)) return candidate;
  }

  const fallbackBuilt = yesNoAreaPuzzle();
  return {
    id: `area_yn-${fallbackBuilt.signature}`,
    type: 'puzzle',
    difficulty: 1000,
    ...fallbackBuilt
  };
};

export const generateAdaptivePuzzleItem = (
  rating: number,
  usedIds: Set<string>,
  prevDifficulty?: number
): PuzzleItem => {
  const target = chooseTargetDifficulty(rating);
  const candidates = Array.from({ length: 24 }, () => buildCandidate(target));
  const fresh = candidates.filter((candidate) => !usedIds.has(candidate.id));
  const pool = fresh.length ? fresh : candidates;
  const scored = pool.map((item) => {
    const jumpPenalty = prevDifficulty === undefined ? 0 : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - 110) * 2.8;
    const key = item.id.split('-')[0];
    let templatePenalty = 0;
    for (const usedId of usedIds) {
      if (usedId.startsWith(`${key}-`)) templatePenalty += 5;
    }
    templatePenalty = Math.min(templatePenalty, 25);
    return { item, score: Math.abs(item.difficulty - target) + jumpPenalty + templatePenalty };
  });
  scored.sort((a, b) => a.score - b.score);
  return pick(scored.slice(0, Math.min(6, scored.length))).item;
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

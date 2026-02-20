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
    extensions: extensions('How many with 12 cadets?', 'Write a rule for n cadets.')
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
  let pairs = factorPairs(squareArea);

  for (let tries = 0; tries < 10 && pairs.length === 0; tries += 1) {
    side = randInt(4, 18);
    squareArea = side * side;
    pairs = factorPairs(squareArea);
  }

  const isYes = Math.random() < 0.55;
  let a = side;
  let b = side;

  if (isYes) {
    const viable = pairs.filter(([x, y]) => !(x === side && y === side));
    const pickPair = viable.length ? pick(viable) : pairs.length ? pick(pairs) : [side, side];
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
    core_prompt: `Can a ${side}x${side} square become a ${a}x${b} rectangle (no stretching)?`,
    core_answer: answer,
    hint_ladder: [
      `Find the square area: ${side}x${side}.`,
      `Find the rectangle area: ${a}x${b}.`,
      'If the areas match, it is possible. If not, it is not.',
      `Compare: ${squareArea} vs ${rectArea}.`
    ],
    solution_steps: [
      `Square area = ${side}x${side} = ${squareArea}.`,
      `Rectangle area = ${a}x${b} = ${rectArea}.`,
      'No stretching means area stays the same.',
      answer === 'Yes' ? 'Areas match, so the answer is Yes.' : 'Areas do not match, so the answer is No.'
    ],
    extensions: extensions('Try making your own Yes example.', 'Try making your own No example.')
  };
};

const alwaysSometimesNeverPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const variant = pick([
    {
      prompt: 'For counting number n, n(n+1) is even.',
      answer: 'Always',
      reason: 'one of two back-to-back numbers is always even',
      title: 'Even-Odd Explorer: Twin Steps'
    },
    {
      prompt: 'For counting number n, n² - n is even.',
      answer: 'Always',
      reason: 'n(n-1) includes one even number',
      title: 'Even-Odd Explorer: Step Back'
    },
    {
      prompt: 'For counting number n, n² + 1 is odd.',
      answer: 'Sometimes',
      reason: 'it depends on whether n is odd or even',
      title: 'Even-Odd Explorer: Plus One'
    }
  ]);

  return {
    signature: `asn-${variant.prompt}`,
    tags: ['proof_lite', 'reasoning'],
    title: variant.title,
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
    signature: `stars-${v.slug}`,
    tags: ['strategy', 'pattern', 'logic'],
    title: v.title,
    answer_type: 'choice',
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
        ? `Since ${n} is not a multiple of 4, take ${winningMove} first to leave ${n - winningMove}, a multiple of 4.`
        : `Since ${n} is a multiple of 4, the other player can always respond to keep multiples of 4.`,
      `So the answer is ${answer}.`
    ],
    extensions: extensions('Try the same game with 20 stars.', 'What if you can take 1 to 4 instead?')
  };
};

type LogicVariant = {
  slug: string;
  title: string;
  prompt: string;
  answer: string;
  accept?: string[];
  hints: string[];
  steps: string[];
};

const LOGIC_VARIANTS: LogicVariant[] = [
  {
    slug: 'truth-lie',
    title: 'Truth or Trick?',
    prompt: 'One alien always tells the truth. One always lies. A says: "B is lying." Who is the truth-teller? (A or B)',
    answer: 'A',
    accept: ['a'],
    hints: [
      'If A is telling the truth, then B must be lying.',
      'If A is lying, then B is telling the truth.',
      'Check which option cannot work.',
      'Only one choice makes sense.'
    ],
    steps: [
      'If A tells the truth, then B is lying.',
      'If A is lying, then B would be telling the truth.',
      'A being truthful gives a clean consistent setup.',
      'So A is the truth-teller.'
    ]
  },
  {
    slug: 'two-statements',
    title: 'Two Statements',
    prompt: 'Only one statement is true: 1) The treasure is on Planet Red. 2) The treasure is NOT on Planet Red. Where is the treasure? (Red or Not Red)',
    answer: 'Not Red',
    accept: ['notred', 'not red'],
    hints: [
      'The two statements are opposites.',
      'If one is true, the other must be false.',
      'Not Red means anywhere except Red.',
      'Pick the only consistent result.'
    ],
    steps: [
      'Either it is on Red, or it is not on Red.',
      'The puzzle says only one statement is true.',
      'The consistent answer is Not Red.'
    ]
  },
  {
    slug: 'three-buttons',
    title: 'Three Buttons',
    prompt: 'A panel has 3 buttons: ZAP, BOOP, and BEEP. Exactly one button opens the door. You press ZAP and the door stays closed. Which buttons could still open the door?',
    answer: 'BOOP or BEEP',
    accept: ['boop and beep', 'boop, beep', 'boop or beep', 'beep or boop'],
    hints: ['ZAP did not work.', 'So it is not ZAP.', 'That leaves two possibilities.', 'Name both.'],
    steps: ['Only one button works.', 'ZAP failed, so ZAP is not the opener.', 'So the opener must be BOOP or BEEP.']
  },
  {
    slug: 'odd-one-out',
    title: 'Odd One Out',
    prompt: 'Which number does NOT belong? 2, 3, 5, 9',
    answer: '9',
    accept: ['nine'],
    hints: [
      'Look for a shared property among three numbers.',
      '2, 3, and 5 are all prime.',
      '9 is not prime.',
      'So 9 is the odd one out.'
    ],
    steps: ['2, 3, and 5 are prime.', '9 has factors 1, 3, and 9.', 'So 9 does not belong.']
  },
  {
    slug: 'always-even',
    title: 'Even Detector',
    prompt: 'Pick the expression that is always even: A) odd + odd B) odd + even C) odd x odd',
    answer: 'A) odd + odd',
    accept: ['a', 'a) odd + odd', 'odd + odd'],
    hints: ['Try small examples.', 'Odd + odd: 3 + 5 = 8.', 'Odd + even gives odd.', 'Odd x odd gives odd.'],
    steps: ['Odd + odd always makes even.', 'Odd + even makes odd.', 'Odd x odd makes odd.', 'So A is always even.']
  },
  {
    slug: 'missing-number',
    title: 'Missing Number',
    prompt: 'Fill in the blank: 4, 8, 12, __, 20',
    answer: '16',
    accept: ['sixteen'],
    hints: ['What is the pattern? +4 each time.', '12 + 4 = 16.', 'Then 16 + 4 = 20.', 'So the blank is 16.'],
    steps: ['The sequence adds 4 each step.', '12 + 4 = 16.', 'So the missing number is 16.']
  },
  {
    slug: 'coin-flip',
    title: 'Coin Flip Logic',
    prompt: 'A coin lands Heads. Which was more likely before the flip? A) Heads B) Tails C) Same chance',
    answer: 'C) Same chance',
    accept: ['c', 'same chance', 'same'],
    hints: ['Before the flip, we did not know the result.', 'A fair coin has equal chances.', 'Heads and tails are equally likely.', 'So it is the same chance.'],
    steps: ['A fair coin has a 50/50 chance.', 'Before the flip, Heads and Tails were equally likely.', 'So the answer is Same chance.']
  },
  {
    slug: 'bigger-fraction',
    title: 'Fraction Faceoff',
    prompt: 'Which is bigger? 3/4 or 5/8',
    answer: '3/4',
    accept: ['3 / 4', 'three quarters'],
    hints: ['Use a common denominator: 3/4 = 6/8.', 'Compare 6/8 and 5/8.', '6/8 is bigger.', 'So 3/4 is bigger.'],
    steps: ['Convert 3/4 to eighths: 3/4 = 6/8.', 'Compare 6/8 vs 5/8.', '6/8 is larger, so 3/4 is larger.']
  },
  {
    slug: 'two-doors',
    title: 'Two Doors',
    prompt: 'Two doors: one is SAFE, one is TRAP. A sign on Door 1 says: "Door 2 is SAFE." A sign on Door 2 says: "Door 1 is TRAP." Exactly one sign is true. Which door is SAFE? (1 or 2)',
    answer: '1',
    accept: ['door 1'],
    hints: [
      'If Door 2 were safe, check both signs.',
      'Door 1 sign would be true.',
      'Door 2 sign would also be true, but only one sign can be true.',
      'So Door 1 must be safe.'
    ],
    steps: [
      'Assume Door 2 is safe: Door 1 sign is true.',
      'Then Door 2 sign ("Door 1 is TRAP") is also true.',
      'That gives two true signs, not allowed.',
      'So Door 1 is safe and exactly one sign is true.'
    ]
  },
  {
    slug: 'estimate-sum',
    title: 'Quick Estimate',
    prompt: 'Which is closest to 51 + 49? A) 80 B) 100 C) 120',
    answer: 'B) 100',
    accept: ['b', '100'],
    hints: ['51 is close to 50.', '49 is close to 50.', '50 + 50 = 100.', 'So 100 is closest.'],
    steps: ['Round 51 to 50 and 49 to 50.', '50 + 50 = 100.', 'So 100 is the closest.']
  }
];

const miniLogicPuzzle = (): Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const v = pick(LOGIC_VARIANTS);
  return {
    signature: `logic-${v.slug}`,
    tags: ['logic', 'reasoning'],
    title: v.title,
    answer_type: 'short_text',
    core_prompt: v.prompt,
    core_answer: v.answer,
    ...(v.accept ? { accept_answers: v.accept } : {}),
    hint_ladder: v.hints,
    solution_steps: [...v.steps, `Answer: ${v.answer}.`],
    extensions: extensions('Try making your own version.', 'Explain your reasoning in one sentence.')
  };
};

const templates: PuzzleTemplate[] = [
  { key: 'pairs', minDifficulty: 900, maxDifficulty: 1150, build: () => pairCountPuzzle() },
  { key: 'area_yn', minDifficulty: 980, maxDifficulty: 1250, build: () => yesNoAreaPuzzle() },
  { key: 'stars', minDifficulty: 1000, maxDifficulty: 1450, build: () => starsStrategyPuzzle() },
  { key: 'logic', minDifficulty: 960, maxDifficulty: 1550, build: () => miniLogicPuzzle() },
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

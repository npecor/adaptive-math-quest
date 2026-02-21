import { chooseTargetDifficulty } from './adaptive';
import type { PuzzleItem } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(items: T[]): T => items[randInt(0, items.length - 1)];
const hasDecimal = (text: string) => /\d+\.\d+/.test(text);
const bannedAlgebraNotation = /\bn\b|n\^2|n²|n\(\s*n\s*[+\-]\s*1\s*\)|n\(\s*n\s*-\s*1\s*\)|n\(\s*n\s*\+\s*1\s*\)/i;

type PuzzleBuild = Omit<PuzzleItem, 'id' | 'difficulty' | 'type'> & {
  signature: string;
  difficultyHint?: number;
};

type PuzzleTemplate = {
  key: string;
  puzzleType: NonNullable<PuzzleItem['puzzleType']>;
  minDifficulty: number;
  maxDifficulty: number;
  baseDifficulty: number;
  weight: number;
  build: (difficulty: number) => PuzzleBuild;
};

type SequenceVariant = {
  slug: string;
  sequence: string;
  choices: string[];
  answer: string;
  strategy: string;
  difficultyHint: number;
};

type OddOneOutVariant = {
  slug: string;
  prompt: string;
  choices: string[];
  answer: string;
  reason: string;
  difficultyHint: number;
};

type WordProblemVariant = {
  slug: string;
  title: string;
  prompt: string;
  answer: number;
  step1: string;
  step2: string;
  step3: string;
  hints: [string, string, string];
  difficultyHint: number;
};

type LogicVariant = {
  slug: string;
  title: string;
  prompt: string;
  choices: string[];
  answer: string;
  hints: [string, string, string];
  steps: [string, string, string];
  difficultyHint: number;
};

const FAST_MATH_STYLE_PUZZLE = [
  /which fraction is (bigger|greater)/i,
  /\b\d+\s*\/\s*\d+\s*(or|vs)\s*\d+\s*\/\s*\d+/i,
  /\bx\s*[+\-*/÷×]\s*\d+\s*=\s*-?\d+/i,
  /^\s*(solve|what is)\s*:?\s*\d+\s*[+\-×x÷/*]\s*\d+/i,
  /^\s*\d+\s*[+\-×x÷/*]\s*\d+\s*=\s*\?\s*$/i
];

const extensions = (one: string, two: string) => [
  { label: 'Bonus 1', prompt: one, answer: 'varies' },
  { label: 'Bonus 2', prompt: two, answer: 'varies' }
];

const ensureThreeSteps = (steps: string[], fallback: string): [string, string, string] => {
  const normalized = steps.map((step) => step.trim()).filter(Boolean).slice(0, 3);
  while (normalized.length < 3) normalized.push(fallback);
  return [normalized[0], normalized[1], normalized[2]];
};

const withThreeStepScaffold = (item: PuzzleBuild): PuzzleBuild => {
  const hints = ensureThreeSteps(item.hint_ladder, 'Try a smaller version first.');
  const steps = ensureThreeSteps(item.solution_steps, 'Now use that same idea on this puzzle.');
  return {
    ...item,
    hint_ladder: hints,
    solution_steps: steps
  };
};

const factorPairs = (n: number): Array<[number, number]> => {
  const pairs: Array<[number, number]> = [];
  for (let a = 2; a * a <= n; a += 1) {
    if (n % a === 0) pairs.push([a, n / a]);
  }
  return pairs;
};

const yesNoAreaPuzzle = (): PuzzleBuild => {
  let side = randInt(4, 18);
  let area = side * side;
  let nonSquarePairs = factorPairs(area).filter(([a, b]) => !(a === side && b === side));

  for (let attempts = 0; attempts < 20 && nonSquarePairs.length === 0; attempts += 1) {
    side = randInt(4, 18);
    area = side * side;
    nonSquarePairs = factorPairs(area).filter(([a, b]) => !(a === side && b === side));
  }

  if (nonSquarePairs.length === 0) {
    side = 12;
    area = side * side;
    nonSquarePairs = factorPairs(area).filter(([a, b]) => !(a === side && b === side));
  }

  const isYes = Math.random() < 0.55;
  let rectA = side;
  let rectB = side;

  if (isYes) {
    [rectA, rectB] = pick(nonSquarePairs);
  } else {
    const candidates: Array<[number, number]> = [];
    for (let a = 2; a <= 24; a += 1) {
      for (let b = 2; b <= 24; b += 1) {
        const rectArea = a * b;
        const closeEnough = Math.abs(rectArea - area) <= Math.max(18, Math.floor(area * 0.25));
        if (rectArea !== area && closeEnough) candidates.push([a, b]);
      }
    }
    [rectA, rectB] = candidates.length ? pick(candidates) : [side + 1, side];
  }

  const rectArea = rectA * rectB;
  const answer: 'Yes' | 'No' = rectArea === area ? 'Yes' : 'No';

  return withThreeStepScaffold({
    signature: `shape-${side}-${rectA}-${rectB}-${answer.toLowerCase()}`,
    puzzleType: 'spatial',
    tags: ['spatial', 'reasoning', 'geometry_area'],
    title: 'Shape Swap',
    answer_type: 'choice',
    choices: ['Yes', 'No'],
    core_prompt: `Can a ${side}×${side} square become a ${rectA}×${rectB} rectangle with no stretching?`,
    core_answer: answer,
    hint_ladder: [
      `Find the square area first: ${side}×${side}.`,
      `Now find the rectangle area: ${rectA}×${rectB}.`,
      'If both areas match, answer Yes. If not, answer No.'
    ],
    solution_steps: [
      `Square area = ${side}×${side} = ${area}.`,
      `Rectangle area = ${rectA}×${rectB} = ${rectArea}.`,
      answer === 'Yes' ? 'Areas match, so the answer is Yes.' : 'Areas do not match, so the answer is No.'
    ],
    extensions: extensions('Make your own Yes example with different dimensions.', 'Make your own No example with close numbers.'),
    difficultyHint: answer === 'No' ? 20 : 0
  });
};

const perimeterSurprisePuzzle = (): PuzzleBuild => {
  const width = randInt(4, 12);
  const height = randInt(4, 12);
  const borderTiles = 2 * (width + height) - 4;
  return withThreeStepScaffold({
    signature: `border-${width}-${height}`,
    puzzleType: 'spatial',
    tags: ['spatial', 'geometry_area', 'perimeter'],
    title: 'Border Tiles',
    answer_type: 'short_text',
    core_prompt: `A launch pad is ${width} by ${height} tiles. How many tiles touch the outer edge?`,
    core_answer: String(borderTiles),
    hint_ladder: [
      'Count around the edge, not the inside.',
      `Use 2×(${width}+${height}) for the border walk.`,
      'Corner tiles get counted twice, so subtract 4.'
    ],
    solution_steps: [
      `Start with 2×(${width}+${height}) = ${2 * (width + height)}.`,
      `Subtract 4 corner repeats: ${2 * (width + height)} - 4 = ${borderTiles}.`,
      `So ${borderTiles} tiles touch the edge.`
    ],
    extensions: extensions('Try a 10 by 10 pad.', 'How does the border change if you add one row?'),
    difficultyHint: borderTiles > 30 ? 25 : 5
  });
};

const constraintSwitchPuzzle = (): PuzzleBuild => {
  return withThreeStepScaffold({
    signature: 'switches-one-trip',
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
    hint_ladder: [
      'Use more than just on or off.',
      'Warm bulbs give extra information after a switch is off.',
      'Make three different lamp states: on, warm-off, and cold-off.'
    ],
    solution_steps: [
      'Turn Switch A on and wait so that lamp gets warm.',
      'Turn A off, turn B on, and keep C off before your one trip.',
      'Upstairs: glowing lamp is B, warm dark lamp is A, cold dark lamp is C.'
    ],
    extensions: extensions('How could you do this with four lamps?', 'Why does heat make this puzzle possible?'),
    difficultyHint: 120
  });
};

const constraintAirlockQuestionPuzzle = (): PuzzleBuild => {
  const bestQuestion = 'Ask either guard: “If I asked the other guard which door is safe, what would they say?” then choose the opposite door.';
  return withThreeStepScaffold({
    signature: 'airlocks-one-question',
    puzzleType: 'constraint',
    tags: ['constraint', 'logic', 'one_chance'],
    title: 'Two Airlocks, One Question',
    answer_type: 'choice',
    choices: [
      bestQuestion,
      'Ask Guard A directly which door is safe and trust the answer.',
      'Ask both guards the same question and pick the matching door.',
      'Pick a random door and run.'
    ],
    core_prompt: 'One guard lies and one tells truth. You can ask ONE yes/no question to ONE guard. What is the best strategy?',
    core_answer: bestQuestion,
    hint_ladder: [
      'You need a question that works on both the liar and truth-teller.',
      'Asking what the other guard would say flips truth twice.',
      'After that question, take the opposite door from the answer.'
    ],
    solution_steps: [
      'Ask either guard what the other guard would point to.',
      'Both guards will point to the wrong door with that question.',
      'Choose the opposite door to reach safety.'
    ],
    extensions: extensions('Write your own one-question strategy.', 'How would this change with three doors?'),
    difficultyHint: 105
  });
};

const constraintNineRocksPuzzle = (): PuzzleBuild => {
  const bestMove = 'Weigh 3 rocks against 3 rocks.';
  return withThreeStepScaffold({
    signature: 'rocks-9-one-weigh',
    puzzleType: 'constraint',
    tags: ['constraint', 'strategy', 'one_chance'],
    title: 'Heavy Rock Check',
    answer_type: 'choice',
    choices: [bestMove, 'Weigh 4 rocks against 4 rocks.', 'Weigh 1 rock against 1 rock.', 'Weigh all 9 rocks at once.'],
    core_prompt: 'You have 9 space rocks and one is heavier. You get one balance weighing. What first move gives the best clue?',
    core_answer: bestMove,
    hint_ladder: [
      'One weighing should split the possibilities into equal groups.',
      'Try dividing 9 into three groups of 3.',
      'A 3-vs-3 weighing tells you which group to focus on next.'
    ],
    solution_steps: [
      'Split rocks into groups: 3, 3, and 3.',
      'Weigh one group of 3 against another group of 3.',
      'If balanced, heavy rock is in the third group; if not, it is in the heavier side.'
    ],
    extensions: extensions('How would you solve it with one more weighing?', 'Try the same idea with 12 rocks.'),
    difficultyHint: 90
  });
};

const alwaysSometimesNeverPuzzle = (): PuzzleBuild => {
  const variants: LogicVariant[] = [
    {
      slug: 'odd-plus-odd',
      title: 'Always / Sometimes / Never',
      prompt: 'Odd number + odd number is even.',
      choices: ['Always', 'Sometimes', 'Never'],
      answer: 'Always',
      hints: [
        'Test a small example like 3 + 5.',
        'Try another one like 7 + 9.',
        'If every test is even, it is Always.'
      ],
      steps: ['3 + 5 = 8, which is even.', '7 + 9 = 16, also even.', 'Odd + odd is always even.'],
      difficultyHint: -30
    },
    {
      slug: 'odd-times-odd',
      title: 'Always / Sometimes / Never',
      prompt: 'Odd number × odd number is even.',
      choices: ['Always', 'Sometimes', 'Never'],
      answer: 'Never',
      hints: [
        'Try 3 × 5 first.',
        'Try 7 × 9 next.',
        'If all results are odd, the statement is Never.'
      ],
      steps: ['3 × 5 = 15, which is odd.', '7 × 9 = 63, also odd.', 'Odd × odd is never even.'],
      difficultyHint: -15
    },
    {
      slug: 'number-times-itself',
      title: 'Always / Sometimes / Never',
      prompt: 'A number times itself is even.',
      choices: ['Always', 'Sometimes', 'Never'],
      answer: 'Sometimes',
      hints: [
        'Try an even number first: 4 × 4.',
        'Now try an odd number: 3 × 3.',
        'If one example is even and one is odd, the answer is Sometimes.'
      ],
      steps: ['4 × 4 = 16, which is even.', '3 × 3 = 9, which is odd.', 'So this is true only sometimes.'],
      difficultyHint: 10
    }
  ];

  const variant = pick(variants);
  return withThreeStepScaffold({
    signature: `asn-${variant.slug}`,
    puzzleType: 'logic',
    tags: ['logic', 'reasoning'],
    title: variant.title,
    answer_type: 'choice',
    choices: variant.choices,
    core_prompt: variant.prompt,
    core_answer: variant.answer,
    hint_ladder: variant.hints,
    solution_steps: variant.steps,
    extensions: extensions('Write your own Always/Sometimes/Never statement.', 'Test your statement with two examples.'),
    difficultyHint: variant.difficultyHint
  });
};

const whoIsLyingPuzzle = (): PuzzleBuild => {
  const variants: LogicVariant[] = [
    {
      slug: 'nova-comet-luna',
      title: 'Who Is Lying?',
      prompt: 'Nova says “Comet did it.” Comet says “Luna did it.” Luna says “Comet is lying.” Exactly one is lying. Who is lying?',
      choices: ['Nova', 'Comet', 'Luna'],
      answer: 'Nova',
      hints: [
        'Test each person as the only liar.',
        'If Nova lies, then Comet did not do it.',
        'Check whether that makes the other two statements true.'
      ],
      steps: [
        'Assume Nova lies, so “Comet did it” is false.',
        'Then Comet saying “Luna did it” can be true, and Luna saying “Comet is lying” can also be true.',
        'That gives exactly one liar: Nova.'
      ],
      difficultyHint: 40
    },
    {
      slug: 'astro-jelly-cosmo',
      title: 'Who Is Lying?',
      prompt: 'Astro says “Jelly found the map.” Jelly says “Cosmo found the map.” Cosmo says “Jelly is truthful.” Exactly one statement is false. Who is lying?',
      choices: ['Astro', 'Jelly', 'Cosmo'],
      answer: 'Astro',
      hints: [
        'Try making Astro the liar first.',
        'If Astro lies, Jelly did not find the map.',
        'Check if Jelly and Cosmo can both stay true.'
      ],
      steps: [
        'Astro lying means Jelly did not find the map.',
        'Jelly saying Cosmo found the map can be true, and Cosmo saying Jelly is truthful can be true.',
        'So Astro is the only liar.'
      ],
      difficultyHint: 55
    }
  ];

  const variant = pick(variants);
  return withThreeStepScaffold({
    signature: `liar-${variant.slug}`,
    puzzleType: 'logic',
    tags: ['logic', 'deduction'],
    title: variant.title,
    answer_type: 'choice',
    choices: variant.choices,
    core_prompt: variant.prompt,
    core_answer: variant.answer,
    hint_ladder: variant.hints,
    solution_steps: variant.steps,
    extensions: extensions('Change one clue and solve again.', 'Make a version with four players.'),
    difficultyHint: variant.difficultyHint
  });
};

const deductionMapPuzzle = (): PuzzleBuild => {
  const answer = 'Moon Dock';
  return withThreeStepScaffold({
    signature: 'deduction-map',
    puzzleType: 'logic',
    tags: ['logic', 'deduction'],
    title: 'Dock Deduction',
    answer_type: 'choice',
    choices: ['Sun Dock', 'Moon Dock', 'Star Dock'],
    core_prompt: 'The map is not at Sun Dock. Star Dock is closed for repairs. Which dock has the map?',
    core_answer: answer,
    hint_ladder: [
      'Cross out places that are impossible.',
      'Sun Dock is ruled out by the first clue.',
      'Star Dock is ruled out by the second clue, so one dock remains.'
    ],
    solution_steps: [
      'Not at Sun Dock removes one choice.',
      'Star Dock closed removes another choice.',
      'Only Moon Dock is left, so that is the answer.'
    ],
    extensions: extensions('Write a new clue that keeps Moon Dock as the answer.', 'Make a four-dock version.'),
    difficultyHint: 0
  });
};

const SEQUENCE_VARIANTS: SequenceVariant[] = [
  {
    slug: 'plus-3',
    sequence: '4, 7, 10, 13, ? ',
    choices: ['14', '15', '16', '17'],
    answer: '16',
    strategy: 'Each number goes up by 3.',
    difficultyHint: -35
  },
  {
    slug: 'double-minus-1',
    sequence: '3, 5, 9, 17, ? ',
    choices: ['25', '31', '33', '35'],
    answer: '33',
    strategy: 'Double then subtract 1 each time.',
    difficultyHint: 25
  },
  {
    slug: 'square-ish',
    sequence: '2, 6, 12, 20, ? ',
    choices: ['28', '30', '32', '34'],
    answer: '30',
    strategy: 'The jumps are +4, +6, +8, so next is +10.',
    difficultyHint: 40
  }
];

const nextPatternPuzzle = (): PuzzleBuild => {
  const variant = pick(SEQUENCE_VARIANTS);
  return withThreeStepScaffold({
    signature: `next-${variant.slug}`,
    puzzleType: 'pattern',
    tags: ['pattern', 'reasoning'],
    title: 'What Comes Next?',
    answer_type: 'choice',
    choices: variant.choices,
    core_prompt: `Find the next number: ${variant.sequence}`,
    core_answer: variant.answer,
    hint_ladder: [
      'Look at how each step changes.',
      variant.strategy,
      'Use that same change one more time.'
    ],
    solution_steps: [
      variant.strategy,
      `Apply the pattern to the last shown number.`,
      `The next number is ${variant.answer}.`
    ],
    extensions: extensions('Build your own sequence with a hidden rule.', 'Challenge a friend with your sequence.'),
    difficultyHint: variant.difficultyHint
  });
};

const ODD_ONE_OUT_VARIANTS: OddOneOutVariant[] = [
  {
    slug: 'prime-mix',
    prompt: 'Which one does not belong: 11, 13, 15, 17?',
    choices: ['11', '13', '15', '17'],
    answer: '15',
    reason: '15 is not prime while the others are prime.',
    difficultyHint: -10
  },
  {
    slug: 'shapes-sides',
    prompt: 'Which one does not belong: triangle, square, pentagon, circle?',
    choices: ['triangle', 'square', 'pentagon', 'circle'],
    answer: 'circle',
    reason: 'A circle has no straight sides, but the others do.',
    difficultyHint: -20
  },
  {
    slug: 'number-forms',
    prompt: 'Which one does not belong: 8, 16, 24, 25?',
    choices: ['8', '16', '24', '25'],
    answer: '25',
    reason: 'The others are multiples of 8; 25 is not.',
    difficultyHint: 15
  }
];

const oddOneOutPuzzle = (): PuzzleBuild => {
  const variant = pick(ODD_ONE_OUT_VARIANTS);
  return withThreeStepScaffold({
    signature: `odd-${variant.slug}`,
    puzzleType: 'pattern',
    tags: ['pattern', 'logic'],
    title: 'Odd One Out',
    answer_type: 'choice',
    choices: variant.choices,
    core_prompt: variant.prompt,
    core_answer: variant.answer,
    hint_ladder: [
      'Find a rule that fits most choices.',
      'Test each option against that rule.',
      'Pick the one that breaks the rule.'
    ],
    solution_steps: [
      'Check what three choices have in common.',
      variant.reason,
      `So the odd one out is ${variant.answer}.`
    ],
    extensions: extensions('Create your own odd-one-out set.', 'Explain your rule in one sentence.'),
    difficultyHint: variant.difficultyHint
  });
};

const symbolPatternPuzzle = (): PuzzleBuild => {
  const cycle = ['🪐', '🌙', '⭐'];
  const shown = [...cycle, ...cycle, '🪐'];
  const answer = '🌙';
  return withThreeStepScaffold({
    signature: 'symbols-orbit-cycle',
    puzzleType: 'pattern',
    tags: ['pattern', 'reasoning'],
    title: 'Orbit Symbols',
    answer_type: 'choice',
    choices: ['🪐', '🌙', '⭐', '☄️'],
    core_prompt: `Which symbol comes next? ${shown.join(' ')}`,
    core_answer: answer,
    hint_ladder: [
      'Look for the repeating chunk.',
      'The cycle is 🪐 then 🌙 then ⭐.',
      'After 🪐, the next symbol in that cycle is 🌙.'
    ],
    solution_steps: [
      'Identify the repeating cycle: 🪐 → 🌙 → ⭐.',
      `The shown line ends on ${shown[shown.length - 1]}.`,
      'So the next symbol is 🌙.'
    ],
    extensions: extensions('Make a 4-symbol cycle.', 'Write a cycle that starts with ⭐.'),
    difficultyHint: -15
  });
};

const WORD_PROBLEM_VARIANTS: WordProblemVariant[] = [
  {
    slug: 'fuel-cells',
    title: 'Space Story: Fuel Cells',
    prompt: 'A shuttle uses 7 fuel cells per hop. It makes 6 hops. How many fuel cells are used?',
    answer: 42,
    step1: 'Each hop uses 7 cells.',
    step2: 'Multiply hops by cells per hop: 6×7.',
    step3: '6×7 = 42 cells total.',
    hints: ['Find the number used in one hop.', 'Count how many hops there are.', 'Multiply to get the total used.'],
    difficultyHint: -5
  },
  {
    slug: 'crystal-crates',
    title: 'Space Story: Crystal Crates',
    prompt: 'Nova collected 54 crystals and packs 6 per crate. How many full crates can she pack?',
    answer: 9,
    step1: 'This is a grouping problem.',
    step2: 'Compute 54 ÷ 6.',
    step3: '54 ÷ 6 = 9 crates.',
    hints: ['Think: how many groups of 6 fit in 54?', 'Use a multiplication check: 6×?=54.', 'The missing number is the crate count.'],
    difficultyHint: 20
  },
  {
    slug: 'snack-balance',
    title: 'Space Story: Snack Supply',
    prompt: 'A station has 36 snacks. Crew eats 8, then supply ship brings 14 more. How many snacks now?',
    answer: 42,
    step1: 'Start with 36 snacks and subtract what was eaten.',
    step2: '36 - 8 = 28, then add the new 14.',
    step3: '28 + 14 = 42 snacks now.',
    hints: ['Do the story in order: subtract then add.', 'After eating, find what remains.', 'Then add the new shipment.'],
    difficultyHint: 35
  },
  {
    slug: 'distance-legs',
    title: 'Space Story: Route Distance',
    prompt: 'A rover travels 18 km to Beacon A, then 27 km to Beacon B. How far total?',
    answer: 45,
    step1: 'Add the two trip legs.',
    step2: '18 + 27 can be split as (18 + 20) + 7.',
    step3: '38 + 7 = 45 km total.',
    hints: ['This asks for a total distance.', 'Add the two parts of the trip.', 'Use tens first if that feels easier.'],
    difficultyHint: 5
  }
];

const wordProblemPuzzle = (): PuzzleBuild => {
  const variant = pick(WORD_PROBLEM_VARIANTS);
  return withThreeStepScaffold({
    signature: `word-${variant.slug}`,
    puzzleType: 'word',
    tags: ['word_problem', 'reasoning'],
    title: variant.title,
    answer_type: 'short_text',
    core_prompt: variant.prompt,
    core_answer: String(variant.answer),
    hint_ladder: [...variant.hints],
    solution_steps: [variant.step1, variant.step2, variant.step3],
    extensions: extensions('Change one number and solve again.', 'Write this story as an equation.'),
    difficultyHint: variant.difficultyHint
  });
};

const templates: PuzzleTemplate[] = [
  {
    key: 'word_story',
    puzzleType: 'word',
    minDifficulty: 900,
    maxDifficulty: 1650,
    baseDifficulty: 1160,
    weight: 30,
    build: () => wordProblemPuzzle()
  },
  {
    key: 'logic_asn',
    puzzleType: 'logic',
    minDifficulty: 900,
    maxDifficulty: 1450,
    baseDifficulty: 1080,
    weight: 9,
    build: () => alwaysSometimesNeverPuzzle()
  },
  {
    key: 'logic_lying',
    puzzleType: 'logic',
    minDifficulty: 980,
    maxDifficulty: 1650,
    baseDifficulty: 1210,
    weight: 8,
    build: () => whoIsLyingPuzzle()
  },
  {
    key: 'logic_deduction',
    puzzleType: 'logic',
    minDifficulty: 920,
    maxDifficulty: 1500,
    baseDifficulty: 1110,
    weight: 8,
    build: () => deductionMapPuzzle()
  },
  {
    key: 'pattern_next',
    puzzleType: 'pattern',
    minDifficulty: 900,
    maxDifficulty: 1600,
    baseDifficulty: 1080,
    weight: 8,
    build: () => nextPatternPuzzle()
  },
  {
    key: 'pattern_odd',
    puzzleType: 'pattern',
    minDifficulty: 900,
    maxDifficulty: 1500,
    baseDifficulty: 1030,
    weight: 6,
    build: () => oddOneOutPuzzle()
  },
  {
    key: 'pattern_symbols',
    puzzleType: 'pattern',
    minDifficulty: 900,
    maxDifficulty: 1480,
    baseDifficulty: 990,
    weight: 6,
    build: () => symbolPatternPuzzle()
  },
  {
    key: 'spatial_area',
    puzzleType: 'spatial',
    minDifficulty: 930,
    maxDifficulty: 1600,
    baseDifficulty: 1130,
    weight: 8,
    build: () => yesNoAreaPuzzle()
  },
  {
    key: 'spatial_border',
    puzzleType: 'spatial',
    minDifficulty: 980,
    maxDifficulty: 1650,
    baseDifficulty: 1220,
    weight: 7,
    build: () => perimeterSurprisePuzzle()
  },
  {
    key: 'constraint_switch',
    puzzleType: 'constraint',
    minDifficulty: 1160,
    maxDifficulty: 1700,
    baseDifficulty: 1370,
    weight: 3.5,
    build: () => constraintSwitchPuzzle()
  },
  {
    key: 'constraint_airlock',
    puzzleType: 'constraint',
    minDifficulty: 1140,
    maxDifficulty: 1700,
    baseDifficulty: 1340,
    weight: 3.3,
    build: () => constraintAirlockQuestionPuzzle()
  },
  {
    key: 'constraint_rocks',
    puzzleType: 'constraint',
    minDifficulty: 1080,
    maxDifficulty: 1680,
    baseDifficulty: 1300,
    weight: 3.2,
    build: () => constraintNineRocksPuzzle()
  }
];

const isFastMathLike = (candidate: PuzzleItem): boolean => {
  const prompt = candidate.core_prompt.trim();
  return FAST_MATH_STYLE_PUZZLE.some((pattern) => pattern.test(prompt));
};

const pickTemplate = (difficulty: number): PuzzleTemplate => {
  const eligible = templates.filter(
    (template) => difficulty >= template.minDifficulty - 80 && difficulty <= template.maxDifficulty + 80
  );
  const pool = eligible.length ? eligible : templates;
  const totalWeight = pool.reduce((sum, template) => sum + template.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const template of pool) {
    roll -= template.weight;
    if (roll <= 0) return template;
  }
  return pool[pool.length - 1];
};

const isKidSafePuzzle = (candidate: PuzzleItem): boolean => {
  const textFields = [
    candidate.title,
    candidate.core_prompt,
    candidate.core_answer,
    ...(candidate.hint_ladder ?? []),
    ...(candidate.solution_steps ?? [])
  ];

  if (textFields.some((text) => bannedAlgebraNotation.test(text))) return false;
  if (candidate.id.startsWith('spatial_area-') && textFields.some((text) => hasDecimal(text))) return false;
  if (isFastMathLike(candidate)) return false;
  if ((candidate.hint_ladder?.length ?? 0) !== 3) return false;
  if ((candidate.solution_steps?.length ?? 0) !== 3) return false;
  return true;
};

const buildCandidate = (targetDifficulty: number): PuzzleItem => {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const target = clamp(Math.round(targetDifficulty + randInt(-60, 60)), 900, 1700);
    const template = pickTemplate(target);
    const built = template.build(target);
    const { signature, difficultyHint, ...safeBuilt } = built;
    const centeredDifficulty = Math.round((target + template.baseDifficulty) / 2 + (difficultyHint ?? 0) + randInt(-35, 35));
    const difficulty = clamp(centeredDifficulty, 900, 1700);
    const candidate: PuzzleItem = {
      id: `${template.key}-${signature}`,
      type: 'puzzle',
      difficulty,
      puzzleType: safeBuilt.puzzleType ?? template.puzzleType,
      ...safeBuilt
    };
    if (isKidSafePuzzle(candidate)) return candidate;
  }

  const fallbackBuilt = wordProblemPuzzle();
  const { signature: fallbackSignature, difficultyHint: fallbackHint, ...safeFallback } = fallbackBuilt;
  const fallbackDifficulty = clamp(1080 + (fallbackHint ?? 0), 900, 1700);
  return {
    id: `word_story-${fallbackSignature}`,
    type: 'puzzle',
    difficulty: fallbackDifficulty,
    puzzleType: safeFallback.puzzleType,
    ...safeFallback
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
    const jumpPenalty =
      prevDifficulty === undefined ? 0 : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - 110) * 2.8;

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

import { chooseTargetDifficulty } from './adaptive';
import type { FlowItem } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(items: T[]): T => items[randInt(0, items.length - 1)];
const shuffle = <T,>(items: T[]): T[] => [...items].sort(() => Math.random() - 0.5);

type Template = {
  key: string;
  minDifficulty: number;
  maxDifficulty: number;
  build: (difficulty: number) => Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string };
};

const createAddSub = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const isAdd = Math.random() < 0.45;
  const a = randInt(18, 95);
  const b = randInt(6, 28);
  const result = isAdd ? a + b : a - b;
  const prompt = isAdd ? `${a} + ${b} = ?` : `${a} - ${b} = ?`;
  return {
    signature: `addsub-${isAdd ? 'add' : 'sub'}-${a}-${b}`,
    tags: ['add_sub'],
    format: 'numeric_input',
    prompt,
    answer: String(result),
    hints: [
      isAdd ? 'Break numbers into tens and ones.' : 'Subtract tens, then subtract ones.',
      isAdd ? `Try ${a} + ${b}.` : `Try ${a} - ${b}.`
    ],
    solution_steps: [
      isAdd ? `Add ${a} and ${b}.` : `Subtract ${b} from ${a}.`,
      `Answer: ${result}.`
    ]
  };
};

const createMultDiv = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const isMult = Math.random() < 0.55;
  if (isMult) {
    const a = randInt(3, 12);
    const b = randInt(3, 12);
    const result = a * b;
    return {
      signature: `mult-${a}-${b}`,
      tags: ['mult_div'],
      format: 'numeric_input',
      prompt: `${a} × ${b} = ?`,
      answer: String(result),
      hints: ['Use your times-table facts.', `Think of ${a} groups of ${b}.`],
      solution_steps: [`${a} × ${b} = ${result}.`, `Answer: ${result}.`]
    };
  }

  const divisor = randInt(3, 12);
  const quotient = randInt(4, 16);
  const dividend = divisor * quotient;
  return {
    signature: `div-${dividend}-${divisor}`,
    tags: ['mult_div'],
    format: 'numeric_input',
    prompt: `${dividend} ÷ ${divisor} = ?`,
    answer: String(quotient),
    hints: ['What number times this number gives the bigger number?', `Try: ${divisor} × ? = ${dividend}.`],
    solution_steps: [`${divisor} × ${quotient} = ${dividend}.`, `So ${dividend} ÷ ${divisor} = ${quotient}.`]
  };
};

const createFractionCompare = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const d1 = randInt(3, 12);
  const d2 = randInt(3, 12);
  const n1 = randInt(1, d1 - 1);
  const n2 = randInt(1, d2 - 1);
  const v1 = n1 / d1;
  const v2 = n2 / d2;
  const answer = v1 === v2 ? 'same' : v1 > v2 ? `${n1}/${d1}` : `${n2}/${d2}`;

  return {
    signature: `frac-${n1}-${d1}-${n2}-${d2}`,
    tags: ['fractions'],
    format: 'multiple_choice',
    prompt: `Which is larger: ${n1}/${d1} or ${n2}/${d2}?`,
    choices: [`${n1}/${d1}`, `${n2}/${d2}`, 'same'],
    answer,
    hints: ['Make the bottoms match, or turn both into decimals.', 'Then see which one is bigger.'],
    solution_steps: [
      `${n1}/${d1} = ${(v1).toFixed(3)}, ${n2}/${d2} = ${(v2).toFixed(3)}.`,
      `So the larger one is ${answer}.`
    ]
  };
};

const createOneStepEquation = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const style = Math.random() < 0.5 ? 'add' : 'mult';
  if (style === 'add') {
    const x = randInt(6, 45);
    const add = randInt(5, 26);
    const rhs = x + add;
    return {
      signature: `eq-add-${x}-${add}`,
      tags: ['equations', 'prealgebra'],
      format: 'numeric_input',
      prompt: `Solve: x + ${add} = ${rhs}`,
      answer: String(x),
      hints: [`Undo +${add} by subtracting ${add}.`, `Try ${rhs} - ${add}.`],
      solution_steps: [`x = ${rhs} - ${add}.`, `x = ${x}.`]
    };
  }

  const x = randInt(3, 20);
  const factor = randInt(2, 12);
  const rhs = x * factor;
  return {
    signature: `eq-mult-${x}-${factor}`,
    tags: ['equations', 'prealgebra'],
    format: 'numeric_input',
    prompt: `Solve: ${factor}x = ${rhs}`,
    answer: String(x),
    hints: [`Split ${rhs} into ${factor} equal groups.`, `What is ${rhs} ÷ ${factor}?`],
    solution_steps: [`x = ${rhs} ÷ ${factor}.`, `x = ${x}.`]
  };
};

const createPercent = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const percent = pick([10, 15, 20, 25, 30]);
  const base = pick([40, 50, 60, 80, 100, 120, 160, 200, 240]);
  const result = (percent / 100) * base;
  return {
    signature: `percent-${percent}-${base}`,
    tags: ['percents'],
    format: 'numeric_input',
    prompt: `What is ${percent}% of ${base}?`,
    answer: String(result),
    hints: ['Percent means “out of 100.”', `Try ${base} × ${percent / 100}.`],
    solution_steps: [`${percent}% of ${base} = ${percent / 100} × ${base}.`, `Answer: ${result}.`]
  };
};

const createRatio = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const a = randInt(1, 9);
  const b = randInt(2, 12);
  const scale = randInt(2, 8);
  const right = b * scale;
  const answer = a * scale;
  return {
    signature: `ratio-${a}-${b}-${scale}`,
    tags: ['ratios_rates'],
    format: 'numeric_input',
    prompt: `${a}:${b} = x:${right}. Solve for x.`,
    answer: String(answer),
    hints: [`${right} is ${scale} times ${b}.`, `Do the same thing to ${a}.`],
    solution_steps: [`Scale by ${scale}.`, `x = ${a} × ${scale} = ${answer}.`]
  };
};

const createGeometry = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  if (Math.random() < 0.5) {
    const l = randInt(5, 15);
    const w = randInt(4, 13);
    const area = l * w;
    return {
      signature: `geo-rect-${l}-${w}`,
      tags: ['geometry_area'],
      format: 'numeric_input',
      prompt: `Area of rectangle ${l} by ${w}?`,
      answer: String(area),
      hints: ['Area means length × width.', `Try ${l} × ${w}.`],
      solution_steps: [`Area = ${l} × ${w}.`, `Answer: ${area}.`]
    };
  }

  const base = randInt(6, 16);
  const height = randInt(4, 14);
  const area = (base * height) / 2;
  return {
    signature: `geo-tri-${base}-${height}`,
    tags: ['geometry_area'],
    format: 'numeric_input',
    prompt: `Area of triangle with base ${base} and height ${height}?`,
    answer: String(area),
    hints: ['Triangle area is half of base × height.', `Try 1/2 × ${base} × ${height}.`],
    solution_steps: [`Area = 1/2 × ${base} × ${height}.`, `Answer: ${area}.`]
  };
};

const createTwoStep = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const x = randInt(4, 18);
  const shift = randInt(2, 9);
  const factor = randInt(2, 6);
  const rhs = factor * (x - shift);
  return {
    signature: `eq-2step-${x}-${shift}-${factor}`,
    tags: ['equations', 'prealgebra'],
    format: 'numeric_input',
    prompt: `Solve: ${factor}(x - ${shift}) = ${rhs}`,
    answer: String(x),
    hints: [`First divide by ${factor}.`, `Then add ${shift}.`],
    solution_steps: [`x - ${shift} = ${rhs / factor}.`, `x = ${x}.`]
  };
};

const createLCM = (): Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string } => {
  const a = pick([6, 8, 9, 10, 12, 14, 15, 16, 18]);
  const b = pick([9, 10, 12, 14, 15, 18, 20, 21, 24]);
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const lcm = (a * b) / gcd(a, b);
  const wrong1 = lcm + pick([2, 4, 6, 8]);
  const wrong2 = lcm - pick([2, 4, 6]);
  const wrong3 = a * b;
  const choices = shuffle([String(lcm), String(Math.max(2, wrong2)), String(wrong1), String(wrong3)]).slice(0, 4);
  if (!choices.includes(String(lcm))) choices[0] = String(lcm);

  return {
    signature: `lcm-${a}-${b}`,
    tags: ['factors_multiples'],
    format: 'multiple_choice',
    prompt: `Least common multiple of ${a} and ${b}?`,
    choices,
    answer: String(lcm),
    hints: ['Write a few multiples of each number.', 'Pick the first one they share.'],
    solution_steps: [`LCM(${a}, ${b}) = ${lcm}.`, `Answer: ${lcm}.`]
  };
};

const templates: Template[] = [
  { key: 'add_sub', minDifficulty: 800, maxDifficulty: 980, build: () => createAddSub() },
  { key: 'mult_div', minDifficulty: 860, maxDifficulty: 1080, build: () => createMultDiv() },
  { key: 'fraction_compare', minDifficulty: 900, maxDifficulty: 1180, build: () => createFractionCompare() },
  { key: 'equation_1', minDifficulty: 980, maxDifficulty: 1260, build: () => createOneStepEquation() },
  { key: 'percent', minDifficulty: 1020, maxDifficulty: 1320, build: () => createPercent() },
  { key: 'ratio', minDifficulty: 1080, maxDifficulty: 1380, build: () => createRatio() },
  { key: 'geometry', minDifficulty: 1120, maxDifficulty: 1500, build: () => createGeometry() },
  { key: 'equation_2', minDifficulty: 1260, maxDifficulty: 1650, build: () => createTwoStep() },
  { key: 'lcm', minDifficulty: 1320, maxDifficulty: 1700, build: () => createLCM() }
];

const pickTemplate = (difficulty: number): Template => {
  const eligible = templates.filter((template) => difficulty >= template.minDifficulty - 80 && difficulty <= template.maxDifficulty + 80);
  if (!eligible.length) return templates[0];
  return pick(eligible);
};

const buildCandidate = (targetDifficulty: number): FlowItem => {
  const difficulty = clamp(Math.round(targetDifficulty + randInt(-45, 45)), 800, 1700);
  const template = pickTemplate(difficulty);
  const built = template.build(difficulty);

  return {
    id: `${template.key}-${built.signature}`,
    type: 'flow',
    difficulty,
    ...built
  };
};

export const generateAdaptiveFlowItem = (rating: number, usedSignatures: Set<string>, prevDifficulty?: number): FlowItem => {
  const target = chooseTargetDifficulty(rating);
  const candidates = Array.from({ length: 24 }, () => buildCandidate(target));
  const fresh = candidates.filter((candidate) => !usedSignatures.has(candidate.id));
  const pool = fresh.length ? fresh : candidates;

  const scored = pool.map((item) => {
    const jumpPenalty = prevDifficulty === undefined ? 0 : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - 90) * 3;
    return {
      item,
      score: Math.abs(item.difficulty - target) + jumpPenalty
    };
  });

  scored.sort((a, b) => a.score - b.score);
  const top = scored.slice(0, Math.min(5, scored.length));
  return pick(top).item;
};

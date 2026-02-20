import { chooseTargetDifficulty, getFlowDiversityPenalty } from './adaptive';
import type { FlowItem } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(items: T[]): T => items[randInt(0, items.length - 1)];
const shuffle = <T,>(items: T[]): T[] => [...items].sort(() => Math.random() - 0.5);
const gcd = (x: number, y: number): number => (y === 0 ? Math.abs(x) : gcd(y, x % y));
const hasDecimalToken = (text: string) => /\d+\.\d+/.test(text);
const isIntegerString = (value: string) => /^-?\d+$/.test(value.trim());

type BuiltFlow = Omit<FlowItem, 'id' | 'difficulty' | 'type'> & { signature: string };

type Template = {
  key: string;
  minDifficulty: number;
  maxDifficulty: number;
  build: (difficulty: number) => BuiltFlow;
};

const createAddSub = (difficulty: number): BuiltFlow => {
  const isAdd = Math.random() < 0.45;
  const a = randInt(18, 95);
  const b = randInt(6, 28);

  if (isAdd) {
    const result = a + b;
    return {
      signature: `addsub-add-${a}-${b}`,
      template: 'add_sub',
      shapeSignature: 'addsub_add',
      tags: ['add_sub'],
      format: 'numeric_input',
      prompt: `${a} + ${b} = ?`,
      answer: String(result),
      hints: [
        'Break into tens and ones.',
        `${a} + ${b}`,
        'Add tens first, then ones.'
      ],
      solution_steps: [`${a} + ${b} = ${result}.`, `Answer: ${result}.`]
    };
  }

  const allowNegative = difficulty >= 980 && Math.random() < 0.2;
  let left = a;
  let right = b;
  if (!allowNegative && left < right) {
    [left, right] = [right, left];
  }
  const result = left - right;
  const shapeSignature = result < 0 ? 'addsub_sub_neg' : 'addsub_sub_pos';
  return {
    signature: `addsub-sub-${left}-${right}`,
    template: 'add_sub',
    shapeSignature,
    tags: ['add_sub'],
    format: 'numeric_input',
    prompt: `${left} - ${right} = ?`,
    answer: String(result),
    hints: [
      'Subtract tens, then ones.',
      `${left} - ${right}`,
      'Check with addition after you solve.'
    ],
    solution_steps: [`${left} - ${right} = ${result}.`, `Answer: ${result}.`]
  };
};

const createMultDiv = (difficulty: number): BuiltFlow => {
  const isMult = Math.random() < 0.55;
  const harder = difficulty >= 1150;

  if (isMult) {
    const a = harder ? randInt(6, 16) : randInt(3, 12);
    const b = harder ? randInt(7, 16) : randInt(3, 12);
    const result = a * b;
    return {
      signature: `mult-${a}-${b}`,
      template: 'mult_div',
      shapeSignature: 'mul_basic',
      tags: ['mult_div'],
      format: 'numeric_input',
      prompt: `${a} × ${b} = ?`,
      answer: String(result),
      hints: [
        'Think in equal groups.',
        `${a} groups of ${b}`,
        'Break one factor to make mental math faster.'
      ],
      solution_steps: [`${a} × ${b} = ${result}.`, `Answer: ${result}.`]
    };
  }

  const divisor = harder ? randInt(6, 16) : randInt(3, 12);
  const quotient = harder ? randInt(8, 22) : randInt(4, 16);
  const dividend = divisor * quotient;
  return {
    signature: `div-${dividend}-${divisor}`,
    template: 'mult_div',
    shapeSignature: 'div_basic',
    tags: ['mult_div'],
    format: 'numeric_input',
    prompt: `${dividend} ÷ ${divisor} = ?`,
    answer: String(quotient),
    hints: [
      'Turn division into multiplication.',
      `${divisor} × ? = ${dividend}`,
      'That missing factor is the answer.'
    ],
    solution_steps: [`${divisor} × ${quotient} = ${dividend}.`, `So ${dividend} ÷ ${divisor} = ${quotient}.`]
  };
};

const createFractionCompare = (): BuiltFlow => {
  const d1 = randInt(3, 12);
  const d2 = randInt(3, 12);
  const n1 = randInt(1, d1 - 1);
  const n2 = randInt(1, d2 - 1);
  const leftCross = n1 * d2;
  const rightCross = n2 * d1;
  const answer = leftCross === rightCross ? 'same' : leftCross > rightCross ? `${n1}/${d1}` : `${n2}/${d2}`;

  return {
    signature: `frac-${n1}-${d1}-${n2}-${d2}`,
    template: 'fraction_compare',
    shapeSignature: 'frac_compare_pair',
    tags: ['fractions'],
    format: 'multiple_choice',
    prompt: `${n1}/${d1} or ${n2}/${d2}: larger?`,
    choices: [`${n1}/${d1}`, `${n2}/${d2}`, 'same'],
    answer,
    hints: [
      'Cross-multiply to compare.',
      `${n1}×${d2} vs ${n2}×${d1}`,
      'Bigger cross-product means bigger fraction.'
    ],
    solution_steps: [`${n1}×${d2} = ${leftCross}, ${n2}×${d1} = ${rightCross}.`, `Larger: ${answer}.`]
  };
};

const createOneStepEquation = (difficulty: number): BuiltFlow => {
  const styles: Array<'x_plus_c' | 'x_minus_c' | 'ax_eq_b' | 'x_over_c'> = ['x_plus_c', 'x_minus_c', 'ax_eq_b', 'x_over_c'];
  const style = pick(styles);
  const harder = difficulty >= 1150;

  if (style === 'x_plus_c') {
    const x = harder ? randInt(20, 90) : randInt(6, 45);
    const c = harder ? randInt(12, 35) : randInt(5, 26);
    const rhs = x + c;
    return {
      signature: `eq-plus-${x}-${c}`,
      template: 'equation_1',
      shapeSignature: 'eq_x_plus_c',
      tags: ['equations', 'prealgebra'],
      format: 'numeric_input',
      prompt: `x + ${c} = ${rhs}`,
      answer: String(x),
      hints: [
        `Undo +${c}.`,
        `${rhs} - ${c}`,
        'That result is x.'
      ],
      solution_steps: [`x = ${rhs} - ${c}.`, `x = ${x}.`]
    };
  }

  if (style === 'x_minus_c') {
    const x = harder ? randInt(24, 95) : randInt(8, 50);
    const c = harder ? randInt(10, 28) : randInt(3, 16);
    const rhs = x - c;
    return {
      signature: `eq-minus-${x}-${c}`,
      template: 'equation_1',
      shapeSignature: 'eq_x_minus_c',
      tags: ['equations', 'prealgebra'],
      format: 'numeric_input',
      prompt: `x - ${c} = ${rhs}`,
      answer: String(x),
      hints: [
        `Undo -${c}.`,
        `${rhs} + ${c}`,
        'That result is x.'
      ],
      solution_steps: [`x = ${rhs} + ${c}.`, `x = ${x}.`]
    };
  }

  if (style === 'ax_eq_b') {
    const x = harder ? randInt(8, 28) : randInt(3, 20);
    const factor = harder ? randInt(5, 14) : randInt(2, 12);
    const rhs = x * factor;
    return {
      signature: `eq-mult-${x}-${factor}`,
      template: 'equation_1',
      shapeSignature: 'eq_ax_eq_b',
      tags: ['equations', 'prealgebra'],
      format: 'numeric_input',
      prompt: `${factor}x = ${rhs}`,
      answer: String(x),
      hints: [
        `Undo ×${factor}.`,
        `${rhs} ÷ ${factor}`,
        'That quotient is x.'
      ],
      solution_steps: [`x = ${rhs} ÷ ${factor}.`, `x = ${x}.`]
    };
  }

  const c = harder ? randInt(3, 12) : randInt(2, 9);
  const rhs = harder ? randInt(8, 30) : randInt(3, 20);
  const x = c * rhs;
  return {
    signature: `eq-div-${x}-${c}`,
    template: 'equation_1',
    shapeSignature: 'eq_x_over_c',
    tags: ['equations', 'prealgebra'],
    format: 'numeric_input',
    prompt: `x/${c} = ${rhs}`,
    answer: String(x),
    hints: [
      `Undo ÷${c}.`,
      `${rhs} × ${c}`,
      'That product is x.'
    ],
    solution_steps: [`x = ${rhs} × ${c}.`, `x = ${x}.`]
  };
};

const createPercent = (difficulty: number): BuiltFlow => {
  const harder = difficulty >= 1150;
  const percent = harder ? pick([12, 15, 18, 20, 24, 25, 30, 35]) : pick([10, 15, 20, 25, 30]);
  const basePool = harder ? [120, 160, 180, 200, 240, 300, 360, 400, 480, 500, 600] : [40, 50, 60, 80, 100, 120, 160, 200, 240, 300, 400];
  let base = pick(basePool);
  let result = (percent / 100) * base;
  for (let attempts = 0; attempts < 24 && !Number.isInteger(result); attempts += 1) {
    base = pick(basePool);
    result = (percent / 100) * base;
  }
  if (!Number.isInteger(result)) {
    const denom = 100 / gcd(percent, 100);
    base = denom * randInt(4, 20);
    result = (percent / 100) * base;
  }
  return {
    signature: `percent-${percent}-${base}`,
    template: 'percent',
    shapeSignature: 'pct_of_number',
    tags: ['percents'],
    format: 'numeric_input',
    prompt: `${percent}% of ${base} = ?`,
    answer: String(result),
    hints: [
      'Percent means out of 100.',
      `(${percent} ÷ 100) × ${base}`,
      'Multiply to get the part.'
    ],
    solution_steps: [`${percent}% of ${base} = (${percent} ÷ 100) × ${base}.`, `Answer: ${result}.`]
  };
};

const createRatio = (difficulty: number): BuiltFlow => {
  const harder = difficulty >= 1150;
  const a = harder ? randInt(2, 12) : randInt(1, 9);
  const b = harder ? randInt(4, 15) : randInt(2, 12);
  const scale = harder ? randInt(3, 10) : randInt(2, 8);
  const right = b * scale;
  const answer = a * scale;
  return {
    signature: `ratio-${a}-${b}-${scale}`,
    template: 'ratio',
    shapeSignature: 'ratio_a_to_b_eq_x_to_d',
    tags: ['ratios_rates'],
    format: 'numeric_input',
    prompt: `${a}:${b} = x:${right}`,
    answer: String(answer),
    hints: [
      'Find how much the right side grew.',
      `${b} → ${right} is ×${scale}`,
      `Do that to ${a}: ${a} × ${scale}`
    ],
    solution_steps: [`Scale by ${scale}.`, `x = ${a} × ${scale} = ${answer}.`]
  };
};

const createGeometry = (difficulty: number): BuiltFlow => {
  const mode = pick(['rect_area', 'rect_perim', 'tri_area'] as const);

  if (mode === 'rect_area') {
    const a = randInt(5, 16);
    const b = randInt(4, 14);
    const area = a * b;
    return {
      signature: `geo-rect-area-${a}-${b}`,
      template: 'geometry',
      shapeSignature: 'geom_rect_area',
      tags: ['geometry_area'],
      format: 'numeric_input',
      prompt: `Rectangle: ${a} by ${b}. Area = ?`,
      answer: String(area),
      hints: [
        'Area = length × width.',
        `${a} × ${b}`,
        'Try a mental trick: split one factor.'
      ],
      solution_steps: [`Area = ${a} × ${b}.`, `Answer: ${area}.`]
    };
  }

  if (mode === 'rect_perim') {
    const a = randInt(5, 16);
    const b = randInt(4, 14);
    const perimeter = 2 * (a + b);
    return {
      signature: `geo-rect-perim-${a}-${b}`,
      template: 'geometry',
      shapeSignature: 'geom_rect_perim',
      tags: ['geometry_area'],
      format: 'numeric_input',
      prompt: `Rectangle: ${a} by ${b}. Perimeter = ?`,
      answer: String(perimeter),
      hints: [
        'Perimeter is the distance around.',
        `Add all sides: ${a}+${b}+${a}+${b}.`,
        `Or do 2×(${a}+${b}).`
      ],
      solution_steps: [`Perimeter = ${a}+${b}+${a}+${b}.`, `Perimeter = ${perimeter}.`]
    };
  }

  const base = randInt(6, 18);
  let height = randInt(4, 14);
  if ((base * height) % 2 !== 0) {
    height += 1;
  }
  const product = base * height;
  const area = product / 2;
  return {
    signature: `geo-tri-area-${base}-${height}`,
    template: 'geometry',
    shapeSignature: 'geom_tri_area',
    tags: ['geometry_area'],
    format: 'numeric_input',
    prompt: `Triangle: base ${base}, height ${height}. Area = ?`,
    answer: String(area),
    hints: [
      'Triangle area is half of a rectangle.',
      `${base}×${height} = ?`,
      'Half of that is the area.'
    ],
    solution_steps: [`${base}×${height} = ${product}.`, `${product} ÷ 2 = ${area}.`]
  };
};

const createTwoStep = (difficulty: number): BuiltFlow => {
  const harder = difficulty >= 1150;
  const style = Math.random() < 0.55 ? 'paren' : 'ax_plus_c';

  if (style === 'paren') {
    const x = harder ? randInt(10, 34) : randInt(4, 18);
    const shift = harder ? randInt(4, 14) : randInt(2, 9);
    const factor = harder ? randInt(3, 9) : randInt(2, 6);
    const rhs = factor * (x - shift);
    return {
      signature: `eq-2step-paren-${x}-${shift}-${factor}`,
      template: 'equation_2',
      shapeSignature: 'eq_a_paren_x_minus_c',
      tags: ['equations', 'prealgebra'],
      format: 'numeric_input',
      prompt: `${factor}(x - ${shift}) = ${rhs}`,
      answer: String(x),
      hints: [
        `First divide by ${factor}.`,
        `Then add ${shift}.`,
        'That result is x.'
      ],
      solution_steps: [`x - ${shift} = ${rhs / factor}.`, `x = ${x}.`]
    };
  }

  const factor = harder ? randInt(3, 11) : randInt(2, 7);
  const c = harder ? randInt(8, 30) : randInt(3, 14);
  const x = harder ? randInt(10, 36) : randInt(4, 18);
  const rhs = factor * x + c;
  return {
    signature: `eq-2step-axplusc-${factor}-${x}-${c}`,
    template: 'equation_2',
    shapeSignature: 'eq_ax_plus_c',
    tags: ['equations', 'prealgebra'],
    format: 'numeric_input',
    prompt: `${factor}x + ${c} = ${rhs}`,
    answer: String(x),
    hints: [
      `First subtract ${c}.`,
      `Then divide by ${factor}.`,
      'That quotient is x.'
    ],
    solution_steps: [`${factor}x = ${rhs - c}.`, `x = ${(rhs - c)} ÷ ${factor} = ${x}.`]
  };
};

const createLCM = (): BuiltFlow => {
  const a = pick([6, 8, 9, 10, 12, 14, 15, 16, 18]);
  let b = pick([9, 10, 12, 14, 15, 18, 20, 21, 24]);
  while (b === a) b = pick([9, 10, 12, 14, 15, 18, 20, 21, 24]);
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const smallestCommonMultiple = (a * b) / gcd(a, b);
  const wrong1 = smallestCommonMultiple + pick([2, 4, 6, 8]);
  const wrong2 = smallestCommonMultiple - pick([2, 4, 6]);
  const wrong3 = a * b;
  const choices = shuffle([String(smallestCommonMultiple), String(Math.max(2, wrong2)), String(wrong1), String(wrong3)]).slice(0, 4);
  if (!choices.includes(String(smallestCommonMultiple))) choices[0] = String(smallestCommonMultiple);

  return {
    signature: `smallest-common-multiple-${a}-${b}`,
    template: 'lcm',
    shapeSignature: 'common_multiple_smallest',
    tags: ['factors_multiples'],
    format: 'multiple_choice',
    prompt: `Smallest shared multiple: ${a} and ${b}`,
    choices,
    answer: String(smallestCommonMultiple),
    hints: [
      `List multiples of ${a}: ${a}, ${a * 2}, ${a * 3}, ...`,
      `List multiples of ${b}: ${b}, ${b * 2}, ${b * 3}, ...`,
      'The first shared match is the smallest shared multiple.'
    ],
    solution_steps: [
      `First shared match: ${smallestCommonMultiple}.`,
      'This is also called the least common multiple.'
    ]
  };
};

const templates: Template[] = [
  { key: 'add_sub', minDifficulty: 800, maxDifficulty: 980, build: (difficulty) => createAddSub(difficulty) },
  { key: 'mult_div', minDifficulty: 860, maxDifficulty: 1080, build: (difficulty) => createMultDiv(difficulty) },
  { key: 'fraction_compare', minDifficulty: 900, maxDifficulty: 1180, build: () => createFractionCompare() },
  { key: 'equation_1', minDifficulty: 980, maxDifficulty: 1260, build: (difficulty) => createOneStepEquation(difficulty) },
  { key: 'percent', minDifficulty: 1020, maxDifficulty: 1320, build: (difficulty) => createPercent(difficulty) },
  { key: 'ratio', minDifficulty: 1080, maxDifficulty: 1380, build: (difficulty) => createRatio(difficulty) },
  { key: 'geometry', minDifficulty: 1120, maxDifficulty: 1500, build: (difficulty) => createGeometry(difficulty) },
  { key: 'equation_2', minDifficulty: 1260, maxDifficulty: 1650, build: (difficulty) => createTwoStep(difficulty) },
  { key: 'lcm', minDifficulty: 1320, maxDifficulty: 1700, build: () => createLCM() }
];

const pickTemplate = (difficulty: number): Template => {
  const eligible = templates.filter((template) => difficulty >= template.minDifficulty - 80 && difficulty <= template.maxDifficulty + 80);
  if (!eligible.length) return templates[0];
  return pick(eligible);
};

const passesConstraints = (item: FlowItem, rating: number): boolean => {
  if (rating < 975) return true;

  if (item.template === 'mult_div') {
    const multMatch = item.prompt.match(/^(\d+)\s*[×x]\s*(\d+)\s*=\s*\?$/);
    if (multMatch) {
      const left = Number(multMatch[1]);
      const right = Number(multMatch[2]);
      const tinyFact = left <= 6 && right <= 6;
      const basicFact = left <= 9 && right <= 9;
      if (tinyFact && Math.random() < 0.92) return false;
      if (basicFact && rating >= 1050 && Math.random() < 0.75) return false;
    }

    const divMatch = item.prompt.match(/^(\d+)\s*÷\s*(\d+)\s*=\s*\?$/);
    if (divMatch) {
      const dividend = Number(divMatch[1]);
      const divisor = Number(divMatch[2]);
      const quotient = divisor === 0 ? 0 : dividend / divisor;
      if (rating >= 975 && divisor <= 6 && quotient <= 6 && Math.random() < 0.92) return false;
      if (dividend <= 100 && divisor <= 12 && rating >= 1050 && Math.random() < 0.8) return false;
    }
  }

  if (item.template === 'equation_1') {
    const addMatch = item.prompt.match(/^x\s*\+\s*(\d+)\s*=\s*(\d+)$/);
    if (addMatch) {
      const c = Number(addMatch[1]);
      const rhs = Number(addMatch[2]);
      if (c <= 12 && rhs <= 30) return false;
    }

    const multMatch = item.prompt.match(/^(\d+)x\s*=\s*(\d+)$/);
    if (multMatch) {
      const factor = Number(multMatch[1]);
      const rhs = Number(multMatch[2]);
      if (factor <= 4 && rhs <= 40) return false;
    }
  }

  return true;
};

const assertIntegerSafe = (candidate: FlowItem) => {
  const textFields: string[] = [
    candidate.prompt,
    candidate.answer,
    ...(candidate.choices ?? []),
    ...(candidate.hints ?? []),
    ...(candidate.solution_steps ?? [])
  ];
  if (textFields.some((field) => hasDecimalToken(field))) return false;
  if (candidate.format === 'numeric_input' && !isIntegerString(candidate.answer)) return false;
  return true;
};

const isTrivialForHardPlus = (item: FlowItem): boolean => {
  const prompt = item.prompt;
  const multMatch = prompt.match(/^(\d+)\s*[×x]\s*(\d+)\s*=\s*\?$/);
  if (multMatch) {
    const left = Number(multMatch[1]);
    const right = Number(multMatch[2]);
    return left <= 9 && right <= 9;
  }

  const divMatch = prompt.match(/^(\d+)\s*÷\s*(\d+)\s*=\s*\?$/);
  if (divMatch) {
    const dividend = Number(divMatch[1]);
    const divisor = Number(divMatch[2]);
    return dividend <= 100 && divisor <= 12;
  }

  const eqAddMatch = prompt.match(/^x\s*\+\s*(\d+)\s*=\s*(\d+)$/);
  if (eqAddMatch) {
    const add = Number(eqAddMatch[1]);
    const rhs = Number(eqAddMatch[2]);
    return add <= 12 && rhs <= 30;
  }

  const eqMulMatch = prompt.match(/^(\d+)x\s*=\s*(\d+)$/);
  if (eqMulMatch) {
    const factor = Number(eqMulMatch[1]);
    const rhs = Number(eqMulMatch[2]);
    return factor <= 4 && rhs <= 40;
  }

  return false;
};

const buildCandidate = (targetDifficulty: number, rating: number): FlowItem => {
  for (let attempts = 0; attempts < 12; attempts += 1) {
    const difficulty = clamp(Math.round(targetDifficulty + randInt(-45, 45)), 800, 1700);
    const template = pickTemplate(difficulty);
    const built = template.build(difficulty);
    const candidate: FlowItem = {
      id: `${template.key}-${built.signature}`,
      type: 'flow',
      difficulty,
      ...built
    };
    if (passesConstraints(candidate, rating) && assertIntegerSafe(candidate)) {
      if (rating >= 1125 && isTrivialForHardPlus(candidate)) continue;
      return candidate;
    }
  }

  const fallbackDifficulty = clamp(Math.round(targetDifficulty), 800, 1700);
  for (let attempts = 0; attempts < 20; attempts += 1) {
    const fallbackTemplate = pickTemplate(fallbackDifficulty);
    const fallback = fallbackTemplate.build(fallbackDifficulty);
    const candidate: FlowItem = {
      id: `${fallbackTemplate.key}-${fallback.signature}`,
      type: 'flow',
      difficulty: fallbackDifficulty,
      ...fallback
    };
    if (assertIntegerSafe(candidate)) {
      if (rating >= 1125 && isTrivialForHardPlus(candidate)) continue;
      return candidate;
    }
  }

  // Guaranteed integer-safe emergency fallback.
  const emergency = createAddSub(Math.max(900, fallbackDifficulty));
  return {
    id: `add_sub-${emergency.signature}`,
    type: 'flow',
    difficulty: fallbackDifficulty,
    ...emergency
  };
};

export const generateAdaptiveFlowItem = (
  rating: number,
  usedSignatures: Set<string>,
  prevDifficulty?: number,
  recentTemplates: string[] = [],
  recentShapes: string[] = []
): FlowItem => {
  const target = chooseTargetDifficulty(rating);
  const candidates = Array.from({ length: 24 }, () => buildCandidate(target, rating));
  const fresh = candidates.filter((candidate) => !usedSignatures.has(candidate.id));
  const pool = fresh.length ? fresh : candidates;

  const scored = pool.map((item) => {
    const jumpPenalty = prevDifficulty === undefined ? 0 : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - 90) * 3;
    const diversityPenalty = getFlowDiversityPenalty(item, recentTemplates, recentShapes);
    return {
      item,
      score: Math.abs(item.difficulty - target) + jumpPenalty + diversityPenalty
    };
  });

  scored.sort((a, b) => a.score - b.score);
  const top = scored.slice(0, Math.min(5, scored.length));
  return pick(top).item;
};

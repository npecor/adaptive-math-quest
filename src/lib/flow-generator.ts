import { FLOW_SELECTION_SETTINGS, chooseTargetDifficulty, getFlowDiversityPenalty } from './adaptive';
import { analyzeFlowItem } from './difficulty-tags';
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
  label: string;
  minDifficulty: number;
  maxDifficulty: number;
  build: (difficulty: number) => BuiltFlow;
};

type DifficultyBand = 'easy' | 'medium' | 'hard' | 'expert' | 'master';

const toBand = (difficulty: number): DifficultyBand => {
  if (difficulty >= 1400) return 'master';
  if (difficulty >= 1250) return 'expert';
  if (difficulty >= 1080) return 'hard';
  if (difficulty >= 920) return 'medium';
  return 'easy';
};

const createAddSub = (difficulty: number): BuiltFlow => {
  const band = toBand(difficulty);
  const isAdd = Math.random() < 0.5;
  const allowNegative = difficulty >= 980 && Math.random() < 0.2;
  const numberRange =
    band === 'easy'
      ? { aMin: 18, aMax: 95, bMin: 6, bMax: 28 }
      : band === 'medium'
        ? { aMin: 40, aMax: 160, bMin: 8, bMax: 70 }
        : band === 'hard'
          ? { aMin: 90, aMax: 360, bMin: 30, bMax: 180 }
          : { aMin: 140, aMax: 980, bMin: 60, bMax: 420 };

  let a = randInt(numberRange.aMin, numberRange.aMax);
  let b = randInt(numberRange.bMin, numberRange.bMax);

  if (isAdd) {
    if (band === 'hard' || band === 'expert' || band === 'master') {
      // Force carry on harder tiers so addition doesn't feel trivial.
      if ((a % 10) + (b % 10) < 10) {
        b += 10 - ((a % 10) + (b % 10));
      }
    }
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

  let left = a;
  let right = b;
  if (band === 'hard' || band === 'expert' || band === 'master') {
    if ((left % 10) >= (right % 10)) {
      right += (left % 10) - (right % 10) + 1;
    }
    if (!allowNegative && left <= right) left = right + randInt(20, 120);
  }
  if (!allowNegative && left < right) {
    [left, right] = [right, left];
  }
  if ((band === 'hard' || band === 'expert' || band === 'master') && Math.abs(left - right) < 8) {
    left += randInt(12, 40);
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
  const band = toBand(difficulty);
  const isMult = Math.random() < 0.55;

  if (isMult) {
    let a: number;
    let b: number;
    if (band === 'easy') {
      a = randInt(3, 12);
      b = randInt(3, 12);
    } else if (band === 'medium') {
      a = randInt(12, 44);
      b = randInt(3, 9);
      if ((a % 10) * b < 10 && Math.random() < 0.5) {
        a += randInt(2, 5);
      }
    } else if (band === 'hard') {
      a = randInt(12, 48);
      b = randInt(11, 29);
    } else if (band === 'expert') {
      a = randInt(18, 64);
      b = randInt(12, 39);
    } else {
      a = randInt(22, 76);
      b = randInt(14, 45);
    }
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

  let divisor: number;
  let quotient: number;
  if (band === 'easy') {
    divisor = randInt(3, 12);
    quotient = randInt(1, 12);
  } else if (band === 'medium') {
    divisor = randInt(4, 12);
    quotient = randInt(12, 36);
  } else if (band === 'hard') {
    divisor = randInt(7, 19);
    quotient = randInt(15, 48);
  } else if (band === 'expert') {
    divisor = randInt(8, 24);
    quotient = randInt(18, 55);
  } else {
    divisor = randInt(10, 28);
    quotient = randInt(22, 68);
  }
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

const createFractionCompare = (difficulty: number): BuiltFlow => {
  const band = toBand(difficulty);
  const easyMode = band === 'easy' || (band === 'medium' && Math.random() < 0.35);
  let d1 = randInt(3, 12);
  let d2 = randInt(3, 12);
  let n1 = randInt(1, d1 - 1);
  let n2 = randInt(1, d2 - 1);
  let shapeSignature = 'frac_compare_pair';
  const extraTags: string[] = [];

  if (easyMode && Math.random() < 0.5) {
    d2 = d1;
    n2 = randInt(1, d2 - 1);
    while (n2 === n1) n2 = randInt(1, d2 - 1);
    shapeSignature = 'frac_compare_same_denominator';
    extraTags.push('frac:same-denominator');
  } else if (easyMode) {
    n2 = n1;
    d2 = randInt(3, 12);
    while (d2 === d1) d2 = randInt(3, 12);
    shapeSignature = 'frac_compare_same_numerator';
    extraTags.push('frac:same-numerator');
  }

  const leftCross = n1 * d2;
  const rightCross = n2 * d1;
  const answer = leftCross === rightCross ? 'same' : leftCross > rightCross ? `${n1}/${d1}` : `${n2}/${d2}`;

  return {
    signature: `frac-${n1}-${d1}-${n2}-${d2}`,
    template: 'fraction_compare',
    shapeSignature,
    tags: ['fractions', ...extraTags],
    format: 'multiple_choice',
    prompt: `${n1}/${d1} or ${n2}/${d2}: larger?`,
    choices: [`${n1}/${d1}`, `${n2}/${d2}`, 'same'],
    answer,
    hints: [
      shapeSignature === 'frac_compare_same_denominator'
        ? 'Same denominator: bigger numerator wins.'
        : shapeSignature === 'frac_compare_same_numerator'
          ? 'Same numerator: smaller denominator is larger.'
          : 'Cross-multiply to compare without decimals.',
      shapeSignature === 'frac_compare_pair' ? `${n1}×${d2} vs ${n2}×${d1}` : `Compare ${n1}/${d1} and ${n2}/${d2}.`,
      'Pick the larger fraction (or same if equal).'
    ],
    solution_steps: [`${n1}×${d2} = ${leftCross}, ${n2}×${d1} = ${rightCross}.`, `Larger: ${answer}.`]
  };
};

const createOneStepEquation = (difficulty: number): BuiltFlow => {
  const band = toBand(difficulty);
  const styles: Array<'x_plus_c' | 'x_minus_c' | 'ax_eq_b' | 'x_over_c'> =
    band === 'easy'
      ? ['x_plus_c', 'x_minus_c', 'ax_eq_b']
      : band === 'medium'
        ? ['x_plus_c', 'x_minus_c', 'ax_eq_b', 'x_over_c']
        : ['x_minus_c', 'ax_eq_b', 'x_over_c'];
  const style = pick(styles);

  if (style === 'x_plus_c') {
    const x = band === 'easy' ? randInt(6, 45) : band === 'medium' ? randInt(14, 95) : randInt(26, 180);
    const c = band === 'easy' ? randInt(5, 18) : band === 'medium' ? randInt(8, 30) : randInt(16, 60);
    const rhs = x + c;
    return {
      signature: `eq-plus-${x}-${c}`,
      template: 'equation_1',
      shapeSignature: 'eq_x_plus_c',
      tags: ['equations', 'prealgebra', 'eq:one-step', 'eq:one-step-add'],
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
    const x = band === 'easy' ? randInt(8, 50) : band === 'medium' ? randInt(16, 100) : randInt(35, 210);
    const c = band === 'easy' ? randInt(3, 16) : band === 'medium' ? randInt(6, 24) : randInt(14, 70);
    const rhs = x - c;
    return {
      signature: `eq-minus-${x}-${c}`,
      template: 'equation_1',
      shapeSignature: 'eq_x_minus_c',
      tags: ['equations', 'prealgebra', 'eq:one-step', 'eq:one-step-sub'],
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
    const x = band === 'easy' ? randInt(3, 16) : band === 'medium' ? randInt(5, 24) : randInt(10, 36);
    const factor = band === 'easy' ? randInt(2, 10) : band === 'medium' ? randInt(3, 12) : randInt(6, 18);
    const rhs = x * factor;
    return {
      signature: `eq-mult-${x}-${factor}`,
      template: 'equation_1',
      shapeSignature: 'eq_ax_eq_b',
      tags: ['equations', 'prealgebra', 'eq:one-step', 'eq:one-step-mul'],
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

  const c = band === 'easy' ? randInt(2, 8) : band === 'medium' ? randInt(3, 12) : randInt(7, 18);
  const rhs = band === 'easy' ? randInt(3, 15) : band === 'medium' ? randInt(6, 24) : randInt(12, 34);
  const x = c * rhs;
  return {
    signature: `eq-div-${x}-${c}`,
    template: 'equation_1',
    shapeSignature: 'eq_x_over_c',
    tags: ['equations', 'prealgebra', 'eq:one-step', 'eq:one-step-div', 'eq:fraction-form'],
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
  const band = toBand(difficulty);
  const percentPool =
    band === 'easy'
      ? [10, 20, 25, 50]
      : band === 'medium'
        ? [10, 15, 20, 25, 30, 50]
        : [12, 15, 18, 20, 24, 25, 30, 35];
  const basePool =
    band === 'easy'
      ? [20, 40, 50, 60, 80, 100, 120, 160, 200]
      : band === 'medium'
        ? [40, 60, 80, 100, 120, 160, 200, 240, 300, 400]
        : [120, 160, 180, 200, 240, 300, 360, 400, 480, 500, 600, 800];
  const percent = pick(percentPool);
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
  const band = toBand(difficulty);
  const a = band === 'easy' ? randInt(1, 8) : band === 'medium' ? randInt(2, 10) : randInt(4, 16);
  const b = band === 'easy' ? randInt(2, 10) : band === 'medium' ? randInt(3, 13) : randInt(6, 20);
  const scale = band === 'easy' ? randInt(2, 6) : band === 'medium' ? randInt(3, 9) : randInt(4, 12);
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

const evaluateOrderOps = (expression: string): number =>
  Function(`"use strict"; return (${expression.replace(/×/g, '*')});`)() as number;

const createOrderOfOps = (difficulty: number): BuiltFlow => {
  const band = toBand(difficulty);
  const withParens = band !== 'easy' && Math.random() < (band === 'medium' ? 0.25 : 0.55);
  const a = band === 'easy' ? randInt(3, 9) : band === 'medium' ? randInt(4, 12) : randInt(6, 18);
  const b = band === 'easy' ? randInt(2, 8) : band === 'medium' ? randInt(3, 11) : randInt(4, 14);
  const c = band === 'easy' ? randInt(2, 8) : band === 'medium' ? randInt(3, 12) : randInt(5, 17);
  const d = band === 'hard' || band === 'expert' || band === 'master' ? randInt(2, 11) : randInt(2, 8);
  const includeTail = band !== 'easy' && Math.random() < 0.45;

  const rawExpression = withParens
    ? `(${a} + ${b}) × ${c}${includeTail ? ` - ${d}` : ''}`
    : `${a} + ${b} × ${c}${includeTail ? ` - ${d}` : ''}`;
  const answer = evaluateOrderOps(rawExpression);
  return {
    signature: `order-${rawExpression.replace(/\s+/g, '')}`,
    template: 'order_ops',
    shapeSignature: withParens ? 'expr_order_ops_parens' : 'expr_order_ops',
    tags: ['order_ops', 'expr:order-of-ops', ...(withParens ? ['expr:has-parens'] : [])],
    format: 'numeric_input',
    prompt: `${rawExpression} = ?`,
    answer: String(answer),
    hints: [
      withParens ? 'Do parentheses first.' : 'Do multiplication before add/subtract.',
      withParens ? `Solve (${a} + ${b}) first, then multiply by ${c}.` : `Compute ${b} × ${c} first.`,
      includeTail ? `Then finish with ${withParens ? 'the subtraction' : 'the remaining add/subtract'}.` : 'Then finish the remaining step.'
    ],
    solution_steps: [
      withParens ? `(${a} + ${b}) first, then × ${c}${includeTail ? `, then - ${d}` : ''}.` : `${b} × ${c} first, then add ${a}${includeTail ? `, then - ${d}` : ''}.`,
      `Answer: ${answer}.`
    ]
  };
};

const createGeometry = (difficulty: number): BuiltFlow => {
  const band = toBand(difficulty);
  const rectRange =
    band === 'easy'
      ? { aMin: 4, aMax: 11, bMin: 3, bMax: 10 }
      : band === 'medium'
        ? { aMin: 5, aMax: 14, bMin: 4, bMax: 13 }
        : band === 'hard'
          ? { aMin: 8, aMax: 20, bMin: 7, bMax: 18 }
          : band === 'expert'
            ? { aMin: 11, aMax: 24, bMin: 8, bMax: 20 }
            : { aMin: 16, aMax: 32, bMin: 12, bMax: 26 };
  const triRange =
    band === 'easy'
      ? { baseMin: 6, baseMax: 14, heightMin: 4, heightMax: 10 }
      : band === 'medium'
        ? { baseMin: 7, baseMax: 17, heightMin: 5, heightMax: 14 }
        : band === 'hard'
          ? { baseMin: 9, baseMax: 24, heightMin: 7, heightMax: 18 }
          : band === 'expert'
            ? { baseMin: 12, baseMax: 28, heightMin: 8, heightMax: 20 }
            : { baseMin: 16, baseMax: 34, heightMin: 12, heightMax: 24 };
  const mode = pick(['rect_area', 'rect_perim', 'tri_area'] as const);

  if (mode === 'rect_area') {
    const a = randInt(rectRange.aMin, rectRange.aMax);
    const b = randInt(rectRange.bMin, rectRange.bMax);
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
    const a = randInt(rectRange.aMin, rectRange.aMax);
    const b = randInt(rectRange.bMin, rectRange.bMax);
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

  const base = randInt(triRange.baseMin, triRange.baseMax);
  let height = randInt(triRange.heightMin, triRange.heightMax);
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
  const band = toBand(difficulty);
  const harder = band === 'hard' || band === 'expert' || band === 'master';
  const style = Math.random() < 0.55 ? 'paren' : 'ax_plus_c';

  if (style === 'paren') {
    const x = harder ? randInt(10, 44) : randInt(4, 18);
    const shift = harder ? randInt(4, 16) : randInt(2, 9);
    const factor = harder ? randInt(3, 11) : randInt(2, 6);
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

  const factor = harder ? randInt(3, 13) : randInt(2, 7);
  const c = harder ? randInt(8, 36) : randInt(3, 14);
  const x = harder ? randInt(10, 42) : randInt(4, 18);
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

export const FLOW_TEMPLATE_CATALOG: Array<{
  key: string;
  label: string;
  minDifficulty: number;
  maxDifficulty: number;
}> = [
  { key: 'add_sub', label: 'Addition + Subtraction', minDifficulty: 800, maxDifficulty: 980 },
  { key: 'mult_div', label: 'Multiplication + Division', minDifficulty: 860, maxDifficulty: 1320 },
  { key: 'fraction_compare', label: 'Fraction Compare', minDifficulty: 860, maxDifficulty: 1220 },
  { key: 'order_ops', label: 'Order of Operations', minDifficulty: 960, maxDifficulty: 1500 },
  { key: 'equation_1', label: 'One-Step Equations', minDifficulty: 980, maxDifficulty: 1180 },
  { key: 'percent', label: 'Percent of Number', minDifficulty: 1020, maxDifficulty: 1320 },
  { key: 'ratio', label: 'Ratios + Proportions', minDifficulty: 1080, maxDifficulty: 1380 },
  { key: 'geometry', label: 'Geometry', minDifficulty: 1120, maxDifficulty: 1500 },
  { key: 'equation_2', label: 'Two-Step Equations', minDifficulty: 1120, maxDifficulty: 1700 },
  { key: 'lcm', label: 'Smallest Shared Multiple', minDifficulty: 1320, maxDifficulty: 1700 }
];

const templates: Template[] = [
  { key: 'add_sub', label: 'Addition + Subtraction', minDifficulty: 800, maxDifficulty: 980, build: (difficulty) => createAddSub(difficulty) },
  { key: 'mult_div', label: 'Multiplication + Division', minDifficulty: 860, maxDifficulty: 1320, build: (difficulty) => createMultDiv(difficulty) },
  { key: 'fraction_compare', label: 'Fraction Compare', minDifficulty: 860, maxDifficulty: 1220, build: (difficulty) => createFractionCompare(difficulty) },
  { key: 'order_ops', label: 'Order of Operations', minDifficulty: 960, maxDifficulty: 1500, build: (difficulty) => createOrderOfOps(difficulty) },
  { key: 'equation_1', label: 'One-Step Equations', minDifficulty: 980, maxDifficulty: 1180, build: (difficulty) => createOneStepEquation(difficulty) },
  { key: 'percent', label: 'Percent of Number', minDifficulty: 1020, maxDifficulty: 1320, build: (difficulty) => createPercent(difficulty) },
  { key: 'ratio', label: 'Ratios + Proportions', minDifficulty: 1080, maxDifficulty: 1380, build: (difficulty) => createRatio(difficulty) },
  { key: 'geometry', label: 'Geometry', minDifficulty: 1120, maxDifficulty: 1500, build: (difficulty) => createGeometry(difficulty) },
  { key: 'equation_2', label: 'Two-Step Equations', minDifficulty: 1120, maxDifficulty: 1700, build: (difficulty) => createTwoStep(difficulty) },
  { key: 'lcm', label: 'Smallest Shared Multiple', minDifficulty: 1320, maxDifficulty: 1700, build: () => createLCM() }
];

const pickTemplate = (difficulty: number): Template => {
  const eligible = templates.filter((template) => difficulty >= template.minDifficulty - 80 && difficulty <= template.maxDifficulty + 80);
  if (!eligible.length) return templates[0];
  return pick(eligible);
};

const passesConstraints = (item: FlowItem, rating: number): boolean => {
  if (rating < 975) {
    if (item.template === 'add_sub' && Number(item.answer) < 0) return false;
    return true;
  }
  const hasTag = (prefixOrTag: string) =>
    prefixOrTag.endsWith(':')
      ? item.tags.some((tag) => tag.startsWith(prefixOrTag))
      : item.tags.includes(prefixOrTag);

  if (item.template === 'mult_div') {
    if (rating >= 975 && hasTag('pattern:times-table') && Math.random() < 0.7) return false;
    if (rating >= 1050 && (hasTag('pattern:×10') || hasTag('pattern:÷10')) && Math.random() < 0.9) return false;
    if (rating >= 1125 && (hasTag('pattern:times-table') || hasTag('pattern:÷2/÷5')) && Math.random() < 0.95) {
      return false;
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
    if (rating >= 1125 && item.difficulty < 1040 && Math.random() < 0.9) return false;
  }

  if (item.template === 'add_sub' && rating >= 1125) {
    const needsBorrowCarry = hasTag('requires:borrow') || hasTag('requires:carry');
    if (!needsBorrowCarry && item.difficulty < 1040 && Math.random() < 0.9) return false;
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
  if (item.difficulty < 1040) return true;
  if (item.tags.some((tag) => tag === 'pattern:times-table' || tag === 'pattern:×10' || tag === 'pattern:÷10')) return true;
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
    const rawCandidate: FlowItem = {
      id: `${template.key}-${built.signature}`,
      type: 'flow',
      difficulty,
      ...built
    };
    const annotated = analyzeFlowItem(rawCandidate);
    const candidate: FlowItem = {
      ...rawCandidate,
      difficulty: annotated.difficultyScore,
      tier: annotated.difficultyLabel,
      tags: [...new Set([...(rawCandidate.tags ?? []), ...annotated.tags])],
      difficultyBreakdown: annotated.breakdown
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
    const rawCandidate: FlowItem = {
      id: `${fallbackTemplate.key}-${fallback.signature}`,
      type: 'flow',
      difficulty: fallbackDifficulty,
      ...fallback
    };
    const annotated = analyzeFlowItem(rawCandidate);
    const candidate: FlowItem = {
      ...rawCandidate,
      difficulty: annotated.difficultyScore,
      tier: annotated.difficultyLabel,
      tags: [...new Set([...(rawCandidate.tags ?? []), ...annotated.tags])],
      difficultyBreakdown: annotated.breakdown
    };
    if (assertIntegerSafe(candidate)) {
      if (rating >= 1125 && isTrivialForHardPlus(candidate)) continue;
      return candidate;
    }
  }

  // Guaranteed integer-safe emergency fallback.
  const emergency = createAddSub(Math.max(900, fallbackDifficulty));
  const emergencyRaw: FlowItem = {
    id: `add_sub-${emergency.signature}`,
    type: 'flow',
    difficulty: fallbackDifficulty,
    ...emergency
  };
  const annotated = analyzeFlowItem(emergencyRaw);
  return {
    ...emergencyRaw,
    difficulty: annotated.difficultyScore,
    tier: annotated.difficultyLabel,
    tags: [...new Set([...(emergencyRaw.tags ?? []), ...annotated.tags])],
    difficultyBreakdown: annotated.breakdown
  };
};

export const generateAdaptiveFlowItem = (
  rating: number,
  usedSignatures: Set<string>,
  prevDifficulty?: number,
  recentTemplates: string[] = [],
  recentShapes: string[] = [],
  recentPatternTags: string[] = [],
  correctStreak = 0
): FlowItem => {
  const target = chooseTargetDifficulty(rating, correctStreak);
  const candidates = Array.from({ length: FLOW_SELECTION_SETTINGS.candidateCount }, () => buildCandidate(target, rating));
  const fresh = candidates.filter((candidate) => !usedSignatures.has(candidate.id));
  const pool = fresh.length ? fresh : candidates;

  const scored = pool.map((item) => {
    const jumpPenalty =
      prevDifficulty === undefined
        ? 0
        : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - FLOW_SELECTION_SETTINGS.jumpPenalty.freeWindow) *
          FLOW_SELECTION_SETTINGS.jumpPenalty.multiplier;
    const diversityPenalty = getFlowDiversityPenalty(item, recentTemplates, recentShapes, recentPatternTags);
    return {
      item,
      score: Math.abs(item.difficulty - target) + jumpPenalty + diversityPenalty
    };
  });

  scored.sort((a, b) => a.score - b.score);
  const top = scored.slice(0, Math.min(FLOW_SELECTION_SETTINGS.topPoolSize, scored.length));
  return pick(top).item;
};

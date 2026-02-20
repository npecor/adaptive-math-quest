import type { FlowItem } from './types';

export type DifficultyTier = 'Easy' | 'Medium' | 'Hard' | 'Expert' | 'Master';

type DifficultyBreakdown = Record<string, number>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const unique = (tags: string[]) => [...new Set(tags)];
const countDigits = (value: number) => String(Math.abs(value)).length;

const addTag = (tags: string[], tag: string) => {
  if (!tags.includes(tag)) tags.push(tag);
};

const addScore = (breakdown: DifficultyBreakdown, key: string, amount: number) => {
  breakdown[key] = (breakdown[key] ?? 0) + amount;
};

export const tierFromDifficulty = (difficulty: number): DifficultyTier => {
  if (difficulty >= 1350) return 'Master';
  if (difficulty >= 1200) return 'Expert';
  if (difficulty >= 1050) return 'Hard';
  if (difficulty >= 900) return 'Medium';
  return 'Easy';
};

const parseBinaryPrompt = (prompt: string, operator: '+' | '-' | '×' | '÷') => {
  const escaped = operator === '+' ? '\\+' : operator;
  const match = prompt.match(new RegExp(`^\\s*(\\d+)\\s*${escaped}\\s*(\\d+)\\s*=\\s*\\?\\s*$`));
  if (!match) return null;
  return { left: Number(match[1]), right: Number(match[2]) };
};

const parseOneStep = (prompt: string) => {
  const plus = prompt.match(/^x\s*\+\s*(\d+)\s*=\s*(\d+)$/);
  if (plus) return { form: 'eq_one_step_add' as const, a: Number(plus[1]), b: Number(plus[2]) };
  const minus = prompt.match(/^x\s*-\s*(\d+)\s*=\s*(\d+)$/);
  if (minus) return { form: 'eq_one_step_add' as const, a: Number(minus[1]), b: Number(minus[2]) };
  const mul = prompt.match(/^(\d+)x\s*=\s*(\d+)$/);
  if (mul) return { form: 'eq_one_step_mul' as const, a: Number(mul[1]), b: Number(mul[2]) };
  const div = prompt.match(/^x\/(\d+)\s*=\s*(\d+)$/);
  if (div) return { form: 'eq_one_step_mul' as const, a: Number(div[1]), b: Number(div[2]) };
  return null;
};

export const annotateFlowItem = (
  item: FlowItem
): { difficulty: number; tier: DifficultyTier; tags: string[]; breakdown: DifficultyBreakdown } => {
  const tags = [...(item.tags ?? [])];
  const breakdown: DifficultyBreakdown = {};
  let score = 900;

  const applyBase = (value: number) => {
    score = value;
    addScore(breakdown, 'base', value);
  };

  switch (item.template) {
    case 'add_sub': {
      applyBase(840);
      const add = parseBinaryPrompt(item.prompt, '+');
      const sub = parseBinaryPrompt(item.prompt, '-');
      if (add) {
        const result = add.left + add.right;
        const carry = (add.left % 10) + (add.right % 10) >= 10;
        addTag(tags, 'form:add_sub');
        addScore(breakdown, 'digits', Math.max(countDigits(add.left), countDigits(add.right), countDigits(result)) * 50);
        if (carry) {
          addTag(tags, 'requires:carry');
          addScore(breakdown, 'carry', 130);
        } else {
          addScore(breakdown, 'no_carry', 30);
        }
        if (add.left === 10 || add.right === 10) {
          addTag(tags, 'pattern:+10');
          addScore(breakdown, 'easy:+10', -170);
        }
        if (add.left <= 2 || add.right <= 2) {
          addTag(tags, 'pattern:+1/+2');
          addScore(breakdown, 'easy:+small', -90);
        }
      } else if (sub) {
        const result = sub.left - sub.right;
        const borrow = (sub.left % 10) < (sub.right % 10);
        addTag(tags, 'form:add_sub');
        addScore(breakdown, 'digits', Math.max(countDigits(sub.left), countDigits(sub.right), countDigits(result)) * 55);
        if (borrow) {
          addTag(tags, 'requires:borrow');
          addScore(breakdown, 'borrow', 145);
        } else {
          addScore(breakdown, 'no_borrow', 35);
        }
        if ([1, 2, 10].includes(sub.right)) {
          addTag(tags, `pattern:-${sub.right}`);
          addScore(breakdown, 'easy:-small', -180);
        }
        if (Math.abs(result) <= 3) addScore(breakdown, 'easy:tiny_gap', -70);
        if (result < 0) addScore(breakdown, 'negative_result', 70);
      }
      break;
    }
    case 'mult_div': {
      applyBase(900);
      const mult = parseBinaryPrompt(item.prompt, '×');
      const div = parseBinaryPrompt(item.prompt, '÷');
      if (mult) {
        const { left, right } = mult;
        addTag(tags, 'form:multiply');
        addScore(breakdown, 'digits', (countDigits(left) + countDigits(right)) * 55);
        if ((left <= 9 && right <= 9) || ((left === 10 || right === 10) && Math.min(left, right) <= 9)) {
          addTag(tags, 'pattern:times-table');
          addScore(breakdown, 'easy:times-table', -220);
        }
        if (left === 10 || right === 10) {
          addTag(tags, 'pattern:×10');
          addScore(breakdown, 'easy:×10', -220);
        }
        if (left % 10 === 0 || right % 10 === 0) {
          addTag(tags, 'pattern:trailing-zero');
          addScore(breakdown, 'easy:trailing-zero', -60);
        }
        if ((left % 10) * (right % 10) >= 10) {
          addTag(tags, 'requires:carry');
          addScore(breakdown, 'carry', 60);
        }
        if (left >= 12 && right >= 12) addScore(breakdown, 'two_digit_mult', 170);
      } else if (div) {
        const { left: dividend, right: divisor } = div;
        const quotient = divisor === 0 ? 0 : dividend / divisor;
        addTag(tags, 'form:divide');
        addScore(breakdown, 'digits', (countDigits(dividend) + countDigits(divisor)) * 45);
        if (divisor === 10) {
          addTag(tags, 'pattern:÷10');
          addScore(breakdown, 'easy:÷10', -220);
        }
        if (divisor === 2 || divisor === 5) {
          addTag(tags, `pattern:÷${divisor}`);
          addScore(breakdown, 'easy:÷2/÷5', -130);
        }
        if (dividend <= 120 && divisor <= 12 && quotient <= 12) {
          addTag(tags, 'pattern:times-table');
          addScore(breakdown, 'easy:table-div', -180);
        }
        if (dividend % 10 === 0 && (divisor % 10 === 0 || divisor === 2 || divisor === 5)) {
          addTag(tags, 'pattern:trailing-zero');
          addScore(breakdown, 'easy:trailing-zero', -70);
        }
        if (dividend >= 200) addScore(breakdown, 'larger_dividend', 80);
        if (divisor >= 13) addScore(breakdown, 'larger_divisor', 70);
      }
      break;
    }
    case 'fraction_compare': {
      applyBase(960);
      addTag(tags, 'form:fraction_compare');
      const match = item.prompt.match(/(\d+)\/(\d+)\s+or\s+(\d+)\/(\d+)/i);
      if (match) {
        const n1 = Number(match[1]);
        const d1 = Number(match[2]);
        const n2 = Number(match[3]);
        const d2 = Number(match[4]);
        const v1 = n1 / d1;
        const v2 = n2 / d2;
        addScore(breakdown, 'denominator_size', Math.round(((d1 + d2) / 2) * 7));
        if (Math.abs(v1 - v2) < 0.1) addScore(breakdown, 'close_values', 90);
        if (d1 <= 6 && d2 <= 6) addScore(breakdown, 'easy_small_denominators', -70);
      }
      break;
    }
    case 'equation_1': {
      applyBase(980);
      const one = parseOneStep(item.prompt);
      if (one) {
        addTag(tags, `form:${one.form}`);
        if (one.form === 'eq_one_step_add') {
          addScore(breakdown, 'one_step_add', 70);
          if (one.a <= 10 && one.b <= 30) addScore(breakdown, 'easy_tiny_add_eq', -150);
          if (one.a >= 18 || one.b >= 70) addScore(breakdown, 'larger_constants', 70);
        } else {
          addScore(breakdown, 'one_step_mul', 110);
          if (one.a <= 5 && one.b <= 12) addScore(breakdown, 'easy_tiny_mul_eq', -150);
          if (one.a >= 9 || one.b >= 16) addScore(breakdown, 'larger_constants', 95);
        }
      }
      break;
    }
    case 'equation_2': {
      applyBase(1210);
      if (item.shapeSignature === 'eq_a_paren_x_minus_c') {
        addTag(tags, 'form:eq_parens');
        addScore(breakdown, 'paren_form', 130);
      } else {
        addTag(tags, 'form:eq_two_step');
        addScore(breakdown, 'two_step_form', 120);
      }
      const numbers = [...item.prompt.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (numbers.length) addScore(breakdown, 'number_scale', Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 2);
      break;
    }
    case 'percent': {
      applyBase(1010);
      const match = item.prompt.match(/^(\d+)%\s+of\s+(\d+)\s*=\s*\?$/i);
      if (match) {
        const percent = Number(match[1]);
        const base = Number(match[2]);
        addTag(tags, 'form:percent');
        if ([10, 20, 25, 50].includes(percent)) {
          addTag(tags, `pattern:${percent}%`);
          addScore(breakdown, 'easy_percent', -130);
        } else if ([15, 30].includes(percent)) {
          addScore(breakdown, 'medium_percent', -35);
        } else {
          addTag(tags, 'pattern:awkward-percent');
          addScore(breakdown, 'awkward_percent', 110);
        }
        if (base >= 400) addScore(breakdown, 'larger_base', 45);
      }
      break;
    }
    case 'ratio': {
      applyBase(1070);
      addTag(tags, 'form:ratio');
      const match = item.prompt.match(/^(\d+):(\d+)\s*=\s*x:(\d+)$/);
      if (match) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        const right = Number(match[3]);
        const scale = right / Math.max(1, b);
        if (Number.isInteger(scale)) addScore(breakdown, 'scale', Math.round(scale) * 18);
        if (a <= 6 && b <= 6 && scale <= 3) addScore(breakdown, 'easy_small_ratio', -80);
        if (right >= 80) addScore(breakdown, 'larger_target', 70);
      }
      break;
    }
    case 'geometry': {
      applyBase(980);
      if (item.shapeSignature === 'geom_rect_perim') {
        addTag(tags, 'form:geometry_perimeter');
        addScore(breakdown, 'perimeter', 110);
      } else if (item.shapeSignature === 'geom_tri_area') {
        addTag(tags, 'form:geometry_triangle_area');
        addScore(breakdown, 'triangle_area', 140);
      } else {
        addTag(tags, 'form:geometry_rect_area');
        addScore(breakdown, 'rect_area', 130);
      }
      const numbers = [...item.prompt.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (numbers.length) {
        const average = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
        addScore(breakdown, 'dimension_scale', Math.round(average * 6));
        const maxNum = Math.max(...numbers);
        if (maxNum >= 14) addScore(breakdown, 'larger_dimensions', 80);
        if (maxNum <= 8) addScore(breakdown, 'easy_small_dimensions', -60);
      }
      break;
    }
    case 'lcm': {
      applyBase(1250);
      addTag(tags, 'form:common_multiple');
      const nums = [...item.prompt.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (nums.length >= 2) {
        const [a, b] = nums;
        if (Math.max(a, b) <= 10) addScore(breakdown, 'easy_small_pair', -80);
        if (Math.min(a, b) >= 12) addScore(breakdown, 'larger_pair', 80);
      }
      break;
    }
    default:
      applyBase(item.difficulty || 900);
  }

  const difficulty = clamp(Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)), 800, 1700);
  const tier = tierFromDifficulty(difficulty);
  return {
    difficulty,
    tier,
    tags: unique(tags),
    breakdown
  };
};

import type { FlowItem } from './types';

export type DifficultyLabel = 'Easy' | 'Medium' | 'Hard' | 'Expert' | 'Master';

type Breakdown = Record<string, number>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const unique = (tags: string[]) => [...new Set(tags)];
const countDigits = (value: number) => String(Math.abs(value)).length;

const addTag = (tags: string[], tag: string) => {
  if (!tags.includes(tag)) tags.push(tag);
};

const addScore = (breakdown: Breakdown, key: string, amount: number) => {
  breakdown[key] = (breakdown[key] ?? 0) + amount;
};

export const difficultyLabelFromScore = (difficultyScore: number): DifficultyLabel => {
  if (difficultyScore >= 1350) return 'Master';
  if (difficultyScore >= 1200) return 'Expert';
  if (difficultyScore >= 1050) return 'Hard';
  if (difficultyScore >= 900) return 'Medium';
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

const parseOrderOpsPrompt = (prompt: string) => {
  const trimmed = prompt.trim();
  if (!trimmed.endsWith('= ?')) return null;
  const expr = trimmed.slice(0, -3).trim();
  if (!/^[\d+\-×() ]+$/.test(expr)) return null;
  if (!expr.includes('×')) return null;
  if (!expr.includes('+') && !expr.includes('-')) return null;
  return {
    expr,
    hasParens: expr.includes('(') || expr.includes(')'),
    terms: [...expr.matchAll(/\d+/g)].map((m) => Number(m[0]))
  };
};

export const analyzeFlowItem = (
  item: FlowItem
): { tags: string[]; difficultyScore: number; difficultyLabel: DifficultyLabel; breakdown: Breakdown } => {
  const tags = [...(item.tags ?? [])];
  const breakdown: Breakdown = {};

  const applyBase = (value: number) => addScore(breakdown, 'base', value);

  switch (item.template) {
    case 'add_sub': {
      applyBase(840);
      const add = parseBinaryPrompt(item.prompt, '+');
      const sub = parseBinaryPrompt(item.prompt, '-');
      addTag(tags, 'form:add_sub');

      if (add) {
        const result = add.left + add.right;
        const carry = (add.left % 10) + (add.right % 10) >= 10;
        addScore(breakdown, 'digits', Math.max(countDigits(add.left), countDigits(add.right), countDigits(result)) * 55);
        if (carry) {
          addTag(tags, 'requires:carry');
          addScore(breakdown, 'carry', 120);
        } else {
          addScore(breakdown, 'no_carry', 30);
        }
        if (add.left === 10 || add.right === 10) {
          addTag(tags, 'pattern:+10');
          addScore(breakdown, 'easy:+10', -170);
        }
      } else if (sub) {
        const result = sub.left - sub.right;
        const borrow = (sub.left % 10) < (sub.right % 10);
        addScore(breakdown, 'digits', Math.max(countDigits(sub.left), countDigits(sub.right), countDigits(result)) * 60);
        if (borrow) {
          addTag(tags, 'requires:borrow');
          addScore(breakdown, 'borrow', 130);
        } else {
          addScore(breakdown, 'no_borrow', 35);
        }
        if ([1, 2, 10].includes(sub.right)) {
          addTag(tags, `pattern:-${sub.right}`);
          addTag(tags, 'pattern:-1/-2/-10');
          addScore(breakdown, 'easy:-small', -170);
        }
        if (result < 0) {
          addTag(tags, 'sub:negative');
          addScore(breakdown, 'negative_result', 95);
        }
      }
      break;
    }
    case 'mult_div': {
      applyBase(840);
      const mult = parseBinaryPrompt(item.prompt, '×');
      const div = parseBinaryPrompt(item.prompt, '÷');
      if (mult) {
        const { left, right } = mult;
        addTag(tags, 'form:multiply');
        addScore(breakdown, 'digits', (countDigits(left) + countDigits(right)) * 35);
        const isTimesTable = left >= 3 && left <= 12 && right >= 3 && right <= 12;
        const isTenVariant = (left === 10 && right >= 3 && right <= 12) || (right === 10 && left >= 3 && left <= 12);
        if (isTimesTable || isTenVariant) {
          addTag(tags, 'pattern:times-table');
          addScore(breakdown, 'easy:times-table', -220);
        }
        if (left === 10 || right === 10) {
          addTag(tags, 'pattern:×10');
          addScore(breakdown, 'easy:×10', -150);
        }
        if (left % 10 === 0 || right % 10 === 0) {
          addTag(tags, 'pattern:trailing-zero');
          addScore(breakdown, 'easy:trailing-zero', -60);
        }
        if (left >= 10 && right >= 10) addScore(breakdown, 'two_digit_by_two_digit', 120);
        if ((left % 10) * (right % 10) >= 10) {
          addTag(tags, 'requires:carry');
          addScore(breakdown, 'carry', 55);
        }
      } else if (div) {
        const { left: dividend, right: divisor } = div;
        const quotient = divisor === 0 ? 0 : dividend / divisor;
        addTag(tags, 'form:divide');
        addScore(breakdown, 'digits', (countDigits(dividend) + countDigits(divisor)) * 30);

        const isTimesTableInverse =
          divisor >= 3 &&
          divisor <= 12 &&
          Number.isInteger(quotient) &&
          quotient >= 1 &&
          quotient <= 12 &&
          dividend === divisor * quotient;
        if (isTimesTableInverse) {
          addTag(tags, 'div:times-table');
          addTag(tags, 'pattern:times-table');
          addScore(breakdown, 'easy:table-div', -220);
        }
        if (divisor === 10) {
          addTag(tags, 'pattern:÷10');
          addScore(breakdown, 'easy:÷10', -150);
        }
        if (divisor === 2 || divisor === 5) {
          addTag(tags, 'pattern:÷2/÷5');
          addScore(breakdown, 'easy:÷2/÷5', -100);
        }
        if (dividend % 10 === 0 && (divisor % 10 === 0 || divisor === 2 || divisor === 5)) {
          addTag(tags, 'pattern:trailing-zero');
          addScore(breakdown, 'easy:trailing-zero', -60);
        }
        if (dividend >= 200) addScore(breakdown, 'larger_dividend', 70);
        if (divisor >= 8) addScore(breakdown, 'larger_divisor', 50);
        if (Number.isFinite(quotient) && quotient >= 20) addScore(breakdown, 'larger_quotient', 40);
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
        if (d1 === d2) {
          addTag(tags, 'frac:same-denominator');
          addScore(breakdown, 'easy:same-denominator', -170);
        }
        if (n1 === n2) {
          addTag(tags, 'frac:same-numerator');
          addScore(breakdown, 'easy:same-numerator', -170);
        }
      }
      break;
    }
    case 'equation_1': {
      applyBase(885);
      const one = parseOneStep(item.prompt);
      if (one) {
        addTag(tags, 'eq:one-step');
        addTag(tags, `form:${one.form}`);
        if (one.form === 'eq_one_step_add') {
          addScore(breakdown, 'one_step_add', 30);
          addScore(breakdown, 'size', (countDigits(one.a) + countDigits(one.b)) * 30);
          if (one.a <= 12 && one.b <= 35) addScore(breakdown, 'easy_tiny_add_eq', -120);
          if (one.a >= 20 || one.b >= 80) addScore(breakdown, 'larger_constants', 35);
        } else {
          addScore(breakdown, 'one_step_mul', 60);
          addScore(breakdown, 'size', (countDigits(one.a) + countDigits(one.b)) * 26);
          if (one.a <= 5 && one.b <= 12) addScore(breakdown, 'easy_tiny_mul_eq', -120);
          if (one.a >= 10 || one.b >= 40) addScore(breakdown, 'larger_constants', 45);
        }
        if (/=\s*-\d+/.test(item.prompt)) {
          addTag(tags, 'sub:negative');
          addScore(breakdown, 'negative_rhs', 120);
        }
      }
      break;
    }
    case 'equation_2': {
      applyBase(1220);
      if (item.shapeSignature === 'eq_a_paren_x_minus_c') {
        addTag(tags, 'form:eq_parens');
        addTag(tags, 'form:eq_two_step');
        addScore(breakdown, 'paren_form', 150);
      } else {
        addTag(tags, 'form:eq_two_step');
        addScore(breakdown, 'two_step_form', 125);
      }
      break;
    }
    case 'percent': {
      applyBase(930);
      const match = item.prompt.match(/^(\d+)%\s+of\s+(\d+)\s*=\s*\?$/i);
      if (match) {
        const percent = Number(match[1]);
        const base = Number(match[2]);
        addTag(tags, 'form:percent');
        if ([10, 20, 25, 50].includes(percent)) {
          addTag(tags, `pattern:${percent}%`);
          addScore(breakdown, 'easy_percent', -150);
        } else if ([15, 30].includes(percent)) {
          addScore(breakdown, 'medium_percent', -40);
        } else {
          addTag(tags, 'pattern:awkward-percent');
          addScore(breakdown, 'awkward_percent', 120);
        }
        if (base >= 400) addScore(breakdown, 'larger_base', 50);
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
        if (a <= 6 && b <= 6 && scale <= 3) addScore(breakdown, 'easy_small_ratio', -90);
      }
      break;
    }
    case 'geometry': {
      applyBase(930);
      if (item.shapeSignature === 'geom_rect_perim') {
        addTag(tags, 'form:geometry_perimeter');
        addScore(breakdown, 'perimeter', 90);
      } else if (item.shapeSignature === 'geom_tri_area') {
        addTag(tags, 'form:geometry_triangle_area');
        addScore(breakdown, 'triangle_area', 120);
      } else {
        addTag(tags, 'form:geometry_rect_area');
        addScore(breakdown, 'rect_area', 95);
      }
      const numbers = [...item.prompt.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (numbers.length) {
        const average = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
        addScore(breakdown, 'dimension_scale', Math.min(60, Math.round(average * 2)));
      }
      break;
    }
    case 'lcm': {
      applyBase(1250);
      addTag(tags, 'form:common_multiple');
      break;
    }
    case 'order_ops': {
      applyBase(980);
      const parsed = parseOrderOpsPrompt(item.prompt);
      addTag(tags, 'expr:order-of-ops');
      if (parsed) {
        addScore(breakdown, 'term_count', parsed.terms.length * 32);
        if (parsed.hasParens) {
          addTag(tags, 'expr:has-parens');
          addScore(breakdown, 'parens_bonus', 140);
        } else {
          addScore(breakdown, 'no_parens', 20);
        }
        const maxTerm = parsed.terms.length ? Math.max(...parsed.terms) : 0;
        addScore(breakdown, 'operand_scale', Math.round(maxTerm * 3));
      } else {
        addScore(breakdown, 'order_ops_default', 120);
      }
      break;
    }
    default:
      applyBase(item.difficulty || 900);
  }

  let difficultyScore = clamp(Math.round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)), 800, 1700);
  if (item.template === 'equation_1' && !tags.includes('sub:negative')) {
    difficultyScore = Math.min(difficultyScore, 1045);
  }
  const difficultyLabel = difficultyLabelFromScore(difficultyScore);
  return {
    tags: unique(tags),
    difficultyScore,
    difficultyLabel,
    breakdown
  };
};

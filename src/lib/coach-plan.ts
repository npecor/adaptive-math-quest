import { difficultyLabelFromScore, type DifficultyLabel } from './difficulty-tags';
import type { FlowItem, PuzzleItem } from './types';

export type CoachPlan = {
  strategyKey: string;
  quickHint: string;
  steps: string[];
  checkTip?: string;
};

type BonusCoachInput = {
  difficulty: number;
  label?: DifficultyLabel;
  puzzleType?: PuzzleItem['puzzleType'];
  prompt: string;
  hintLadder?: string[];
  solutionSteps?: string[];
};

const normalizeSpace = (text: string) => text.replace(/\s+/g, ' ').trim();

const stripStepPrefix = (text: string) => text.replace(/^step\s*\d+\s*[:.)-]\s*/i, '');

const kidify = (text: string) =>
  normalizeSpace(stripStepPrefix(text))
    .replace(/\binverse operation\b/gi, 'opposite move')
    .replace(/\bdecompose\b/gi, 'break apart')
    .replace(/\bfactors?\b/gi, 'numbers')
    .replace(/\bdenominator\b/gi, 'bottom number')
    .replace(/\bnumerator\b/gi, 'top number')
    .replace(/\bundo\b/gi, 'work backwards')
    .replace(/\bmultipliers?\b/gi, 'times number')
    .replace(/\bdistributive property\b/gi, 'break-apart math superpower');

const isVagueCoachLine = (text: string) =>
  /try your best|you can always adjust|do your best|just guess|good luck/i.test(text);

const compactUnique = (lines: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const kidLine = kidify(line);
    if (!kidLine || kidLine.length < 8 || isVagueCoachLine(kidLine)) continue;
    const key = kidLine.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(kidLine);
  }
  return output;
};

const inferLabel = (difficulty: number, explicit?: DifficultyLabel): DifficultyLabel =>
  explicit ?? difficultyLabelFromScore(difficulty);

const stepCapFor = (label: DifficultyLabel) => {
  if (label === 'Rookie' || label === 'Easy') return 2;
  if (label === 'Medium' || label === 'Hard') return 3;
  return 4;
};

const strategyLineForFlow = (item: FlowItem) => {
  if (item.template === 'add_sub') return 'Break apart into tens and ones.';
  if (item.template === 'mult_div') return 'Use same-size groups or break apart.';
  if (item.template === 'fraction_compare') return 'Compare piece size, not just numbers.';
  if (item.template === 'order_ops') return 'Solve the multiply/divide chunk first.';
  if (item.template.startsWith('equation')) return 'Get x by itself one move at a time.';
  if (item.template === 'ratio') return 'Use the same times number on both sides.';
  if (item.template === 'percent') return 'Start with 10% or 50%, then build from there.';
  if (item.template === 'geometry') return 'Use the shape rule, then plug in numbers.';
  return 'Break the problem into small moves.';
};

const strategyLineForPuzzle = (item: PuzzleItem | BonusCoachInput) => {
  if (item.puzzleType === 'constraint') return 'Use the one thing that gives the most information.';
  if (item.puzzleType === 'logic') return 'Use each clue and cross out choices.';
  if (item.puzzleType === 'pattern') return 'Find the rule before picking.';
  if (item.puzzleType === 'spatial') return 'Draw or picture the shape parts.';
  return 'Break the story into small steps.';
};

const splitNumber = (value: number): [number, number] => {
  if (value >= 12) {
    const tens = Math.floor(value / 10) * 10;
    const ones = value - tens;
    if (ones > 0) return [tens, ones];
  }
  if (value >= 4) return [value - 2, 2];
  return [value - 1, 1];
};

const buildMultiplyBreakApart = (left: number, right: number) => {
  const splitRight = (right >= 10 && right % 10 !== 0) || (left < 10 && right >= left);
  const original = splitRight ? right : left;
  const [partA, partB] = splitNumber(original);
  if (splitRight) {
    return {
      quickHint: `Break ${right} into ${partA} + ${partB}.`,
      steps: [
        `Rewrite ${left}×${right} as ${left}×${partA} + ${left}×${partB}.`,
        `Solve each part, then put together.`
      ]
    };
  }
  return {
    quickHint: `Break ${left} into ${partA} + ${partB}.`,
    steps: [
      `Rewrite ${left}×${right} as ${partA}×${right} + ${partB}×${right}.`,
      'Solve each part, then put together.'
    ]
  };
};

const buildAddSubPlan = (
  prompt: string
): { strategyKey: string; quickHint: string; steps: string[]; checkTip?: string } | null => {
  const match = prompt.match(/^(-?\d+)\s*([+-])\s*(-?\d+)\s*=\s*\?$/);
  if (!match) return null;

  const left = Number(match[1]);
  const op = match[2];
  const right = Number(match[3]);
  const answer = op === '+' ? left + right : left - right;

  if (op === '-' && (right === 10 || right === 100)) {
    const placeWord = right === 10 ? 'one ten' : 'one hundred';
    return {
      strategyKey: 'subtract_place_value',
      quickHint: `Subtracting ${right} moves you down ${placeWord}: ${left} → ${answer}.`,
      steps: [`Subtract ${right} directly from ${left}.`, `${left} - ${right} = ${answer}.`],
      checkTip: `Check: ${answer} + ${right} = ${left}.`
    };
  }

  if (op === '+' && (right === 10 || right === 100)) {
    const placeWord = right === 10 ? 'one ten' : 'one hundred';
    return {
      strategyKey: 'add_place_value',
      quickHint: `Adding ${right} moves you up ${placeWord}: ${left} → ${answer}.`,
      steps: [`Add ${right} directly to ${left}.`, `${left} + ${right} = ${answer}.`],
      checkTip: `Check by taking away ${right}: ${answer} - ${right} = ${left}.`
    };
  }

  if (Math.abs(right) <= 10) {
    if (op === '+') {
      return {
        strategyKey: 'add_count_on',
        quickHint: `Start at ${left}, then count up ${right}.`,
        steps: [`Count up ${right} steps from ${left}.`, `${left} + ${right} = ${answer}.`]
      };
    }
    return {
      strategyKey: 'subtract_count_back',
      quickHint: `Start at ${left}, then count back ${right}.`,
      steps: [`Count back ${right} steps from ${left}.`, `${left} - ${right} = ${answer}.`],
      checkTip: `Check: ${answer} + ${right} = ${left}.`
    };
  }

  const tens = Math.floor(Math.abs(right) / 10) * 10;
  const ones = Math.abs(right) - tens;
  if (ones > 0) {
    const signedTens = right < 0 ? -tens : tens;
    const signedOnes = right < 0 ? -ones : ones;
    const firstStepAnswer = op === '+' ? left + signedTens : left - signedTens;
    return {
      strategyKey: op === '+' ? 'add_break_apart' : 'subtract_break_apart',
      quickHint: `Break ${right} into ${signedTens} and ${signedOnes}.`,
      steps: [
        op === '+'
          ? `Do tens first: ${left} + ${signedTens} = ${firstStepAnswer}.`
          : `Do tens first: ${left} - ${signedTens} = ${firstStepAnswer}.`,
        op === '+' ? `${firstStepAnswer} + ${signedOnes} = ${answer}.` : `${firstStepAnswer} - ${signedOnes} = ${answer}.`
      ]
    };
  }

  return {
    strategyKey: op === '+' ? 'add_direct' : 'subtract_direct',
    quickHint: op === '+' ? `Add ${right} directly.` : `Subtract ${right} directly.`,
    steps: [op === '+' ? `${left} + ${right} = ${answer}.` : `${left} - ${right} = ${answer}.`]
  };
};

const buildEquationPlan = (prompt: string): { quickHint: string; steps: string[]; checkTip?: string } | null => {
  const plus = prompt.match(/^x\s*\+\s*(\d+)\s*=\s*(\d+)$/);
  if (plus) {
    const add = Number(plus[1]);
    const rhs = Number(plus[2]);
    const answer = rhs - add;
    return {
      quickHint: `To find x, take away ${add} from ${rhs}.`,
      steps: ['Get x alone.', `${rhs} - ${add} = ${answer}.`, `So x = ${answer}.`],
      checkTip: `Check by plugging in: ${answer} + ${add} = ${rhs}.`
    };
  }
  const minus = prompt.match(/^x\s*-\s*(\d+)\s*=\s*(\d+)$/);
  if (minus) {
    const takeAway = Number(minus[1]);
    const rhs = Number(minus[2]);
    const answer = rhs + takeAway;
    return {
      quickHint: `To find x, add ${takeAway} to ${rhs}.`,
      steps: ['Get x alone.', `${rhs} + ${takeAway} = ${answer}.`, `So x = ${answer}.`],
      checkTip: `Check by plugging in: ${answer} - ${takeAway} = ${rhs}.`
    };
  }
  const mul = prompt.match(/^(\d+)x\s*=\s*(-?\d+)$/);
  if (mul) {
    const factor = Number(mul[1]);
    const rhs = Number(mul[2]);
    const answer = rhs / factor;
    return {
      quickHint: `Split ${rhs} into equal groups of ${factor}.`,
      steps: ['Get x alone.', `${rhs} ÷ ${factor} = ${answer}.`, `So x = ${answer}.`],
      checkTip: `Check by multiplying: ${factor}×${answer} = ${rhs}.`
    };
  }
  const div = prompt.match(/^x\/(\d+)\s*=\s*(-?\d+)$/);
  if (div) {
    const divisor = Number(div[1]);
    const rhs = Number(div[2]);
    const answer = rhs * divisor;
    return {
      quickHint: `Multiply ${rhs} by ${divisor} to get x.`,
      steps: ['Get x alone.', `${rhs} × ${divisor} = ${answer}.`, `So x = ${answer}.`],
      checkTip: `Check by dividing: ${answer} ÷ ${divisor} = ${rhs}.`
    };
  }
  return null;
};

const buildFractionComparePlan = (prompt: string): { quickHint: string; steps: string[] } | null => {
  const match = prompt.match(/(\d+)\/(\d+)\s+or\s+(\d+)\/(\d+)/i);
  if (!match) return null;
  const n1 = Number(match[1]);
  const d1 = Number(match[2]);
  const n2 = Number(match[3]);
  const d2 = Number(match[4]);
  if (d1 === d2) {
    return {
      quickHint: 'Same bottom number? Bigger top number is bigger.',
      steps: ['Bottom numbers match, so compare top numbers.', `Pick ${Math.max(n1, n2)}/${d1}.`]
    };
  }
  if (n1 === n2) {
    return {
      quickHint: 'Same top number? Smaller bottom number means bigger pieces.',
      steps: ['Top numbers match, so compare bottom numbers.', `Pick ${n1}/${Math.min(d1, d2)}.`]
    };
  }
  return {
    quickHint: 'Try a benchmark: which one is closer to 1?',
    steps: ['Compare how far each is from 1 whole.', 'Pick the one with larger pieces.']
  };
};

const buildOrderOpsPlan = (prompt: string): { quickHint: string; steps: string[] } | null => {
  if (!/×|÷/.test(prompt) || !/[+-]/.test(prompt)) return null;
  return {
    quickHint: 'Find the multiply/divide chunk first.',
    steps: [
      'Solve the multiply/divide chunk first.',
      'Plug that result back into the line.',
      'Finish the add/subtract moves.'
    ]
  };
};

const finalizePlan = (input: {
  difficulty: number;
  explicitLabel?: DifficultyLabel;
  strategyKey: string;
  quickHint: string;
  steps: string[];
  fallbackStepLine: string;
  checkTip?: string;
}): CoachPlan => {
  const label = inferLabel(input.difficulty, input.explicitLabel);
  const cap = stepCapFor(label);
  const minSteps = label === 'Rookie' || label === 'Easy' ? 1 : 2;

  const cleanSteps = compactUnique(input.steps);
  const steps = cleanSteps.slice(0, cap);
  while (steps.length < minSteps) {
    const fallback = kidify(input.fallbackStepLine);
    if (!fallback || steps.includes(fallback)) break;
    steps.push(fallback);
  }

  const fallbackQuick = steps[0] ?? kidify(input.fallbackStepLine) ?? 'Start with one small move.';
  return {
    strategyKey: input.strategyKey,
    quickHint: kidify(input.quickHint) || fallbackQuick,
    steps,
    checkTip: input.checkTip ? kidify(input.checkTip) : undefined
  };
};

export const buildFlowCoachPlan = (item: FlowItem): CoachPlan => {
  const addSubPlan = item.template === 'add_sub' ? buildAddSubPlan(item.prompt) : null;
  if (addSubPlan) {
    return finalizePlan({
      difficulty: item.difficulty,
      explicitLabel: item.tier,
      strategyKey: addSubPlan.strategyKey,
      quickHint: addSubPlan.quickHint,
      steps: addSubPlan.steps,
      fallbackStepLine: 'Do one small number move at a time.',
      checkTip: addSubPlan.checkTip
    });
  }

  const equationPlan = buildEquationPlan(item.prompt);
  if (equationPlan) {
    return finalizePlan({
      difficulty: item.difficulty,
      explicitLabel: item.tier,
      strategyKey: 'equation_one_step',
      quickHint: equationPlan.quickHint,
      steps: equationPlan.steps,
      fallbackStepLine: 'Keep x by itself and do one move.',
      checkTip: equationPlan.checkTip
    });
  }

  const multMatch = item.prompt.match(/^(\d+)\s*[×x]\s*(\d+)\s*=\s*\?$/);
  if (item.template === 'mult_div' && multMatch) {
    const left = Number(multMatch[1]);
    const right = Number(multMatch[2]);
    if (left === 10 || right === 10) {
      const base = left === 10 ? right : left;
      return finalizePlan({
        difficulty: item.difficulty,
        explicitLabel: item.tier,
        strategyKey: 'multiply_by_ten',
        quickHint: `Multiplying by 10 adds a zero. ${base} becomes ${item.answer}.`,
        steps: [`Start with ${base}.`, `${base} × 10 = ${item.answer}.`, 'Same idea: move digits one place left.'],
        fallbackStepLine: 'Multiply by 10 means add one zero.'
      });
    }
    if (left <= 12 && right <= 12) {
      return finalizePlan({
        difficulty: item.difficulty,
        explicitLabel: item.tier,
        strategyKey: 'times_table',
        quickHint: `Use the fact ${left}×${right}.`,
        steps: [`Think of ${right} groups of ${left}.`, `Put the groups together to get ${item.answer}.`],
        fallbackStepLine: 'Use same-size groups and count the total.'
      });
    }
    const breakPlan = buildMultiplyBreakApart(left, right);
    return finalizePlan({
      difficulty: item.difficulty,
      explicitLabel: item.tier,
      strategyKey: 'multiply_break_apart',
      quickHint: breakPlan.quickHint,
      steps: [...breakPlan.steps, `Your answer is ${item.answer}.`],
      fallbackStepLine: 'Break one number into tens and ones.'
    });
  }

  const divMatch = item.prompt.match(/^(\d+)\s*[÷/]\s*(\d+)\s*=\s*\?$/);
  if (item.template === 'mult_div' && divMatch) {
    const dividend = Number(divMatch[1]);
    const divisor = Number(divMatch[2]);
    if (divisor === 10) {
      return finalizePlan({
        difficulty: item.difficulty,
        explicitLabel: item.tier,
        strategyKey: 'divide_by_ten',
        quickHint: `Dividing by 10 removes one zero. ${dividend} becomes ${item.answer}.`,
        steps: [`${dividend} ÷ 10 = ${item.answer}.`, 'Same idea: move digits one place right.'],
        fallbackStepLine: 'Divide by 10 means remove one zero.'
      });
    }
  }

  const fracPlan = item.template === 'fraction_compare' ? buildFractionComparePlan(item.prompt) : null;
  if (fracPlan) {
    return finalizePlan({
      difficulty: item.difficulty,
      explicitLabel: item.tier,
      strategyKey: 'fraction_compare',
      quickHint: fracPlan.quickHint,
      steps: fracPlan.steps,
      fallbackStepLine: 'Compare piece size, then choose the bigger fraction.'
    });
  }

  const orderOpsPlan = item.template === 'order_ops' ? buildOrderOpsPlan(item.prompt) : null;
  if (orderOpsPlan) {
    return finalizePlan({
      difficulty: item.difficulty,
      explicitLabel: item.tier,
      strategyKey: 'order_ops',
      quickHint: orderOpsPlan.quickHint,
      steps: orderOpsPlan.steps,
      fallbackStepLine: 'Solve chunks in order, then finish the line.'
    });
  }

  const baseHints = item.hints ?? [];
  const baseSteps = item.solution_steps ?? [];
  return finalizePlan({
    difficulty: item.difficulty,
    explicitLabel: item.tier,
    strategyKey: item.template || 'flow',
    quickHint: baseHints[0] ?? strategyLineForFlow(item),
    steps: [...baseSteps, ...baseHints],
    fallbackStepLine: strategyLineForFlow(item),
    checkTip: item.template.startsWith('equation') ? 'Plug your answer back in to check.' : undefined
  });
};

export const buildPuzzleCoachPlan = (item: PuzzleItem): CoachPlan =>
  finalizePlan({
    difficulty: item.difficulty,
    strategyKey: item.puzzleType ?? 'puzzle',
    quickHint: item.hint_ladder?.[0] ?? strategyLineForPuzzle(item),
    steps: [...(item.solution_steps ?? []), ...(item.hint_ladder ?? [])],
    fallbackStepLine: strategyLineForPuzzle(item),
    checkTip: 'Make sure your answer matches every clue.'
  });

export const buildBonusCoachPlan = (bonus: BonusCoachInput): CoachPlan =>
  finalizePlan({
    difficulty: bonus.difficulty,
    explicitLabel: bonus.label,
    strategyKey: bonus.puzzleType ?? 'bonus',
    quickHint: bonus.hintLadder?.[0] ?? strategyLineForPuzzle(bonus),
    steps: [...(bonus.solutionSteps ?? []), ...(bonus.hintLadder ?? [])],
    fallbackStepLine: strategyLineForPuzzle(bonus),
    checkTip: 'Pick the choice that uses the most clues.'
  });

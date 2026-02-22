import {
  FLOW_SELECTION_SETTINGS,
  FLOW_TARGET_DISTRIBUTION,
  TRAINING_EARLY_QUESTION_CAP,
  TRAINING_START_RATING,
  TRAINING_TARGET_DISTRIBUTION,
  clampTrainingRating,
  updateTrainingRating
} from '../src/lib/adaptive';
import { buildBonusTarget, createBonusChallenge, type BonusChallenge } from '../src/lib/bonus-generator';
import { buildFlowCoachPlan, buildPuzzleCoachPlan } from '../src/lib/coach-plan';
import { analyzeFlowItem, difficultyLabelFromScore, type DifficultyLabel } from '../src/lib/difficulty-tags';
import { FLOW_TEMPLATE_CATALOG, generateAdaptiveFlowItem } from '../src/lib/flow-generator';
import { generateAdaptivePuzzleItem } from '../src/lib/puzzle-generator';
import type { FlowItem, PuzzleItem } from '../src/lib/types';

const TIERS = [
  { name: 'Rookie', rating: 810 },
  { name: 'Easy', rating: 850 },
  { name: 'Medium', rating: 975 },
  { name: 'Hard', rating: 1125 },
  { name: 'Expert', rating: 1275 },
  { name: 'Master', rating: 1425 }
] as const;

const isCiMode = process.argv.includes('--ci');
const FLOW_SELECTIONS_PER_BAND = isCiMode ? 2000 : 20000;
const SAMPLE_COUNT_PER_TIER = 30;
const PUZZLE_SANITY_COUNT = isCiMode ? 100 : 500;

const hasDecimal = (text: string) => /\d+\.\d+/.test(text);
const startsWithTemplate = (id: string, template: string) => id.startsWith(`${template}-`);
const percent = (n: number, total: number) => ((n / total) * 100).toFixed(2);
const REWRITE_PATTERN = /(=\s*[0-9() +×x*\-/]+[+\-]\s*[0-9() +×x*\-/]+)|(\(\d+\s*[+\-]\s*\d+\))|(\bdouble\b)/i;
const BREAK_WORD_PATTERN = /\b(split|break)\b/i;
const HARD_PLUS_LABELS = new Set<DifficultyLabel>(['Hard', 'Expert', 'Master']);
const COACH_BANNED_TERMS = /\binverse operation|decompose|undo\s*\+?\d*|factors?\b/i;
const FAST_MATH_STYLE_PUZZLE = [
  /which is (bigger|greater).*\d+\/\d+/i,
  /\b\d+\s*\/\s*\d+\s*(or|vs)\s*\d+\s*\/\s*\d+/i,
  /x\s*[+\-*/÷×]\s*\d+\s*=\s*-?\d+/i,
  /which is closest to/i,
  /^\s*(solve|what is)\s*:\s*\d+\s*[+\-×x÷]\s*\d+/i,
  /^\s*\d+\s*[+\-×x÷/*]\s*\d+\s*=\s*\?\s*$/i
];

const toSortedEntries = (counts: Record<string, number>) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]);

const inferFlowLabel = (item: FlowItem): DifficultyLabel => item.tier ?? difficultyLabelFromScore(item.difficulty);

const hasConcreteRewriteHint = (item: FlowItem): boolean => {
  const hintBlob = item.hints.join(' ');
  if (!BREAK_WORD_PATTERN.test(hintBlob)) return true;
  return item.hints.some((hint) => REWRITE_PATTERN.test(hint));
};

const parseAddSub = (prompt: string): { a: number; b: number; op: '+' | '-' } | null => {
  const m = prompt.match(/^\s*(\d+)\s*([+-])\s*(\d+)\s*=\s*\?\s*$/);
  if (!m) return null;
  return { a: Number(m[1]), op: m[2] as '+' | '-', b: Number(m[3]) };
};

const isRookieSimpleAddSub = (item: FlowItem): boolean => {
  if (item.template !== 'add_sub') return false;
  const parsed = parseAddSub(item.prompt);
  if (!parsed) return false;
  return parsed.a <= 9 && parsed.b <= 9;
};

const isTrivialForHardPlus = (item: FlowItem): boolean => {
  const p = item.prompt;
  if (item.tags.some((tag) => ['pattern:times-table', 'pattern:×10', 'pattern:÷10', 'pattern:÷2/÷5'].includes(tag))) return true;
  const mm = p.match(/^\s*(\d+)\s*[×x]\s*(\d+)\s*=\s*\?\s*$/);
  if (mm) return Number(mm[1]) <= 9 && Number(mm[2]) <= 9;
  const dm = p.match(/^\s*(\d+)\s*÷\s*(\d+)\s*=\s*\?\s*$/);
  if (dm) return Number(dm[1]) <= 100 && Number(dm[2]) <= 12;
  const emAdd = p.match(/^\s*x\s*\+\s*(\d+)\s*=\s*(\d+)\s*$/);
  if (emAdd) return Number(emAdd[1]) <= 12 && Number(emAdd[2]) <= 30;
  const emMul = p.match(/^\s*(\d+)x\s*=\s*(\d+)\s*$/);
  if (emMul) return Number(emMul[1]) <= 4 && Number(emMul[2]) <= 40;
  return false;
};

const getUglyFlags = (item: FlowItem, previous: FlowItem | null): string[] => {
  const flags: string[] = [];
  const label = inferFlowLabel(item);
  if (previous && previous.template === item.template) flags.push('repeat-template');
  if (previous && previous.shapeSignature === item.shapeSignature) flags.push('repeat-shape');
  if (['Hard', 'Expert', 'Master'].includes(label) && isTrivialForHardPlus(item)) flags.push('trivial-hardplus');
  if (
    item.template === 'equation_1' &&
    item.tags.includes('eq:one-step') &&
    !item.tags.includes('sub:negative') &&
    ['Hard', 'Expert', 'Master'].includes(label)
  ) {
    flags.push('mislabel:eq-one-step');
  }
  if (item.prompt.length < 8) flags.push('too-short');
  if (hasDecimal(item.prompt) || hasDecimal(item.answer)) flags.push('decimal');
  return flags;
};

const validateCoachPlan = (
  context: string,
  plan: { quickHint: string; steps: string[] },
  failures: string[]
) => {
  const quick = plan.quickHint.trim();
  if (!quick) failures.push(`Coach quick hint missing: ${context}`);
  if (quick.length < 8) failures.push(`Coach quick hint too short: ${context} :: "${quick}"`);
  if (COACH_BANNED_TERMS.test(quick)) failures.push(`Coach quick hint has banned wording: ${context} :: "${quick}"`);
  if (!Array.isArray(plan.steps) || plan.steps.length < 2) {
    failures.push(`Coach steps missing progression: ${context}`);
    return;
  }
  if (plan.steps.length > 4) failures.push(`Coach steps exceed 4: ${context}`);
  const normalizedSteps = plan.steps.map((step) => step.trim().toLowerCase());
  if (new Set(normalizedSteps).size !== normalizedSteps.length) {
    failures.push(`Coach steps duplicate wording: ${context} :: ${plan.steps.join(' | ')}`);
  }
  for (const step of plan.steps) {
    if (step.trim().length < 8) failures.push(`Coach step too short: ${context} :: "${step}"`);
    if (COACH_BANNED_TERMS.test(step)) failures.push(`Coach step has banned wording: ${context} :: "${step}"`);
  }
};

function printDistributionTable(title: string, counts: Record<string, number>, total: number, limit = 999): void {
  console.log(`\n${title}`);
  const rows = toSortedEntries(counts).slice(0, limit);
  for (const [key, count] of rows) {
    console.log(`  ${key.padEnd(32)} ${String(count).padStart(6)}  (${percent(count, total)}%)`);
  }
}

function printFlowTemplateCatalog(): void {
  console.log('\n=== Flow Templates (Current Catalog) ===');
  for (const template of FLOW_TEMPLATE_CATALOG) {
    console.log(
      `  ${template.key.padEnd(18)} ${template.label.padEnd(28)} range ${template.minDifficulty}-${template.maxDifficulty}`
    );
  }
}

function printAdaptiveInputsAndFormula(): void {
  console.log('\n=== Adaptive Next-Item Inputs (Single Source of Truth) ===');
  console.log('  Inputs passed to generateAdaptiveFlowItem():');
  console.log('  - rating');
  console.log('  - usedSignatures (run.usedFlowIds)');
  console.log('  - prevDifficulty (previous item difficulty)');
  console.log(`  - recentTemplates (last ${FLOW_SELECTION_SETTINGS.recentHistorySize})`);
  console.log(`  - recentShapes (last ${FLOW_SELECTION_SETTINGS.recentHistorySize})`);
  console.log(`  - recentPatternTags (last ${FLOW_SELECTION_SETTINGS.recentHistorySize})`);
  console.log('  - correctStreak (run.flowStreak)');
  console.log('  Rating update inputs (separate from selection):');
  console.log('  - rating, item.difficulty, correct, attemptsCount, correctStreak');

  const base = FLOW_TARGET_DISTRIBUTION.base;
  const streak = FLOW_TARGET_DISTRIBUTION.streak;
  console.log('\n  Target difficulty distribution:');
  console.log(
    `  - Base weights: near ${base.near * 100}% | above ${base.above * 100}% | below ${base.below * 100}%`
  );
  console.log(
    `  - Streak (>=${streak.trigger}) weights: near ${streak.near * 100}% | above ${streak.above * 100}% | below ${streak.below * 100}%`
  );
  console.log(
    `  - Near uses Gaussian(mean=rating+shift, sd=${base.nearSd} base / ${streak.nearSd} streak)`
  );
  console.log(
    `  - Above range: +${base.aboveRange[0]}..+${base.aboveRange[1]} | Below range: ${base.belowRange[0]}..${base.belowRange[1]}`
  );

  const jump = FLOW_SELECTION_SETTINGS.jumpPenalty;
  const diversity = FLOW_SELECTION_SETTINGS.diversityPenalty;
  console.log('\n  Candidate scoring formula:');
  console.log(`  - Candidate count: ${FLOW_SELECTION_SETTINGS.candidateCount}`);
  console.log(
    `  - score = abs(item.difficulty - target) + jumpPenalty + diversityPenalty`
  );
  console.log(
    `  - jumpPenalty = max(0, abs(item.difficulty - prevDifficulty) - ${jump.freeWindow}) * ${jump.multiplier}`
  );
  console.log(
    `  - diversityPenalty = +${diversity.templateLast2} template-in-last-2, +${diversity.templateLast4} template-in-last-4, +${diversity.shapeLast2} shape-in-last-2, +${diversity.patternLast3} pattern-in-last-3`
  );
  console.log(`  - Select random pick from top ${FLOW_SELECTION_SETTINGS.topPoolSize} scored candidates`);

  console.log('\n  Training-mode target distribution:');
  console.log(
    `  - Flow profile: near ${TRAINING_TARGET_DISTRIBUTION.flow.near * 100}% | above ${TRAINING_TARGET_DISTRIBUTION.flow.above * 100}% | below ${TRAINING_TARGET_DISTRIBUTION.flow.below * 100}% (sd ${TRAINING_TARGET_DISTRIBUTION.flow.nearSd})`
  );
  console.log(
    `  - Puzzle profile: near ${TRAINING_TARGET_DISTRIBUTION.puzzle.near * 100}% | above ${TRAINING_TARGET_DISTRIBUTION.puzzle.above * 100}% | below ${TRAINING_TARGET_DISTRIBUTION.puzzle.below * 100}% (sd ${TRAINING_TARGET_DISTRIBUTION.puzzle.nearSd})`
  );
  console.log(
    `  - Training start rating = min(skillRating, ${TRAINING_START_RATING}); early cap window = ${TRAINING_EARLY_QUESTION_CAP} questions`
  );
}

function runFlowDistributionAndAssertions(): { failures: string[] } {
  const failures: string[] = [];
  console.log(`\n=== Flow Selection Frequency (${FLOW_SELECTIONS_PER_BAND.toLocaleString()} picks per rating band) ===`);

  for (const tier of TIERS) {
    const used = new Set<string>();
    let prevDifficulty: number | undefined;
    let recentTemplates: string[] = [];
    let recentShapes: string[] = [];
    let recentPatternTags: string[] = [];
    let correctStreak = 0;

    const templateCounts: Record<string, number> = {};
    const labelCounts: Record<string, number> = {};
    const subtypeCounts: Record<string, number> = {};
    let subtractionCount = 0;
    let easyNegativeSubtractions = 0;
    let rookieSimpleAddSubCount = 0;
    let hardPlusTrivial = 0;
    let oneStepHardPlus = 0;
    const decimalExamples: string[] = [];

    for (let i = 0; i < FLOW_SELECTIONS_PER_BAND; i += 1) {
      const item = generateAdaptiveFlowItem(
        tier.rating,
        used,
        prevDifficulty,
        recentTemplates,
        recentShapes,
        recentPatternTags,
        correctStreak
      );

      const label = inferFlowLabel(item);
      templateCounts[item.template] = (templateCounts[item.template] ?? 0) + 1;
      labelCounts[label] = (labelCounts[label] ?? 0) + 1;
      subtypeCounts[item.shapeSignature] = (subtypeCounts[item.shapeSignature] ?? 0) + 1;

      const decimalFields = [item.prompt, item.answer, ...(item.choices ?? []), ...item.hints, ...item.solution_steps];
      if (decimalFields.some((field) => hasDecimal(field))) {
        decimalExamples.push(`${item.id} :: ${item.prompt} => ${item.answer}`);
      }
      if (item.choices?.length) {
        const uniqueCount = new Set(item.choices).size;
        if (uniqueCount !== item.choices.length) {
          failures.push(`Duplicate MC choices detected: ${item.id} :: [${item.choices.join(', ')}]`);
        }
      }
      if (!Array.isArray(item.hints) || item.hints.length !== 3) {
        failures.push(`Hints length != 3 for ${item.id}`);
      }
      const coachPlan = buildFlowCoachPlan(item);
      validateCoachPlan(`flow:${item.id}`, coachPlan, failures);
      if (Array.isArray(item.hints)) {
        const normalizedHints = item.hints.map((hint) => hint.trim().toLowerCase());
        if (new Set(normalizedHints).size !== normalizedHints.length) {
          failures.push(`Flow hints repeat wording for ${item.id}: ${item.hints.join(' | ')}`);
        }
      }
      if (!hasConcreteRewriteHint(item)) {
        failures.push(`Missing concrete rewrite hint for ${item.id}: ${item.hints.join(' | ')}`);
      }

      const addSub = parseAddSub(item.prompt);
      if (addSub?.op === '-') {
        subtractionCount += 1;
        if (Number(item.answer) < 0) easyNegativeSubtractions += 1;
      }
      if (tier.name === 'Rookie' && isRookieSimpleAddSub(item)) rookieSimpleAddSubCount += 1;

      if (tier.rating >= 1125 && isTrivialForHardPlus(item)) hardPlusTrivial += 1;
      if (
        item.template === 'equation_1' &&
        item.tags.includes('eq:one-step') &&
        !item.tags.includes('sub:negative') &&
        ['Hard', 'Expert', 'Master'].includes(label)
      ) {
        oneStepHardPlus += 1;
      }

      const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
      recentTemplates = [...recentTemplates, item.template].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      recentShapes = [...recentShapes, item.shapeSignature].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      recentPatternTags = [...recentPatternTags, ...patternTags].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      prevDifficulty = item.difficulty;
      used.add(item.id);
      if (i % 10 === 0) used.clear();

      // deterministic pseudo-feedback so streak-driven target shifting is exercised in sampling.
      if (item.difficulty <= tier.rating + 25) correctStreak = Math.min(correctStreak + 1, 8);
      else correctStreak = 0;
    }

    console.log(`\n--- ${tier.name} @ rating ${tier.rating} ---`);
    printDistributionTable('% chosen by template', templateCounts, FLOW_SELECTIONS_PER_BAND);
    printDistributionTable('% chosen by label', labelCounts, FLOW_SELECTIONS_PER_BAND);
    printDistributionTable('Top 10 most-common subtypes', subtypeCounts, FLOW_SELECTIONS_PER_BAND, 10);
    console.log(
      `\n  Rookie/Easy-negative-subtraction rate: ${subtractionCount ? percent(easyNegativeSubtractions, subtractionCount) : '0.00'}% (${easyNegativeSubtractions}/${subtractionCount})`
    );
    if (tier.name === 'Rookie') {
      console.log(
        `  Rookie single-digit add/sub rate: ${percent(rookieSimpleAddSubCount, FLOW_SELECTIONS_PER_BAND)}% (${rookieSimpleAddSubCount}/${FLOW_SELECTIONS_PER_BAND})`
      );
    }
    if (tier.rating >= 1125) {
      console.log(
        `  Hard+ trivial pattern rate: ${percent(hardPlusTrivial, FLOW_SELECTIONS_PER_BAND)}% (${hardPlusTrivial}/${FLOW_SELECTIONS_PER_BAND})`
      );
    }
    if (oneStepHardPlus > 0) {
      console.log(`  One-step equation Hard+ count: ${oneStepHardPlus}`);
    }

    if (decimalExamples.length > 0) {
      failures.push(`Decimal text found in flow generation at ${tier.name}. Example: ${decimalExamples[0]}`);
    }
    if ((tier.name === 'Rookie' || tier.name === 'Easy') && easyNegativeSubtractions > 0) {
      failures.push(`${tier.name} tier produced ${easyNegativeSubtractions} negative subtraction answers.`);
    }
    if (tier.name === 'Rookie' && rookieSimpleAddSubCount < FLOW_SELECTIONS_PER_BAND * 0.65) {
      failures.push(
        `Rookie tier not simple enough: ${rookieSimpleAddSubCount}/${FLOW_SELECTIONS_PER_BAND} single-digit add/sub.`
      );
    }
    if (tier.rating >= 1125 && hardPlusTrivial > 0) {
      failures.push(`Hard+ trivial content detected at ${tier.name}: ${hardPlusTrivial} cases.`);
    }
    if (oneStepHardPlus > 0) {
      failures.push(`One-step equations mislabeled Hard+ at ${tier.name}: ${oneStepHardPlus} cases.`);
    }
  }

  return { failures };
}

function printFlowSamples(): { failures: string[] } {
  const failures: string[] = [];
  console.log(`\n=== Flow Samples (${SAMPLE_COUNT_PER_TIER} per tier) ===`);
  for (const tier of TIERS) {
    const used = new Set<string>();
    let prevDifficulty: number | undefined;
    let recentTemplates: string[] = [];
    let recentShapes: string[] = [];
    let recentPatternTags: string[] = [];
    let correctStreak = 0;
    let previous: FlowItem | null = null;

    console.log(`\n## ${tier.name}`);
    for (let i = 0; i < SAMPLE_COUNT_PER_TIER; i += 1) {
      const item = generateAdaptiveFlowItem(
        tier.rating,
        used,
        prevDifficulty,
        recentTemplates,
        recentShapes,
        recentPatternTags,
        correctStreak
      );
      const label = inferFlowLabel(item);
      const flags = getUglyFlags(item, previous);
      const ugly = flags.length ? `FLAG:${flags.join('|')}` : 'ok';
      console.log(
        `${String(i + 1).padStart(2, '0')}. ${item.template}/${item.shapeSignature} | ${label} d=${item.difficulty} | ${item.prompt} | ans=${item.answer} | ${ugly}`
      );
      if (flags.includes('decimal')) failures.push(`Decimal in sample ${item.id}`);

      const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
      recentTemplates = [...recentTemplates, item.template].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      recentShapes = [...recentShapes, item.shapeSignature].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      recentPatternTags = [...recentPatternTags, ...patternTags].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      prevDifficulty = item.difficulty;
      previous = item;
      used.add(item.id);
      if (item.difficulty <= tier.rating + 25) correctStreak = Math.min(correctStreak + 1, 8);
      else correctStreak = 0;
    }
  }
  return { failures };
}

function printRookieSamples(): { failures: string[] } {
  const failures: string[] = [];
  const SAMPLE_COUNT = 20;
  const used = new Set<string>();
  let prevDifficulty: number | undefined;
  let recentTemplates: string[] = [];
  let recentShapes: string[] = [];
  let recentPatternTags: string[] = [];
  let printed = 0;
  let attempts = 0;
  let simpleCount = 0;

  console.log(`\n=== Rookie Samples (${SAMPLE_COUNT}) ===`);
  while (printed < SAMPLE_COUNT && attempts < 1200) {
    const item = generateAdaptiveFlowItem(
      810,
      used,
      prevDifficulty,
      recentTemplates,
      recentShapes,
      recentPatternTags,
      0,
      860
    );
    attempts += 1;
    const label = inferFlowLabel(item);
    if (label !== 'Rookie') continue;
    printed += 1;
    console.log(
      `${String(printed).padStart(2, '0')}. ${item.template}/${item.shapeSignature} | ${label} d=${item.difficulty} | ${item.prompt} | ans=${item.answer}`
    );
    if (isRookieSimpleAddSub(item)) simpleCount += 1;
    const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
    recentTemplates = [...recentTemplates, item.template].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
    recentShapes = [...recentShapes, item.shapeSignature].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
    recentPatternTags = [...recentPatternTags, ...patternTags].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
    prevDifficulty = item.difficulty;
    used.add(item.id);
  }

  if (printed < SAMPLE_COUNT) {
    failures.push(`Could not collect ${SAMPLE_COUNT} Rookie samples (collected ${printed}).`);
  }
  if (printed > 0 && simpleCount / printed < 0.7) {
    failures.push(`Rookie samples not simple enough: ${simpleCount}/${printed} single-digit add/sub.`);
  }
  return { failures };
}

function printCoachSamples(): { failures: string[] } {
  const failures: string[] = [];
  console.log(`\n=== Coach Samples (shared quick hint + steps) ===`);
  const used = new Set<string>();
  let prevDifficulty: number | undefined;
  let recentTemplates: string[] = [];
  let recentShapes: string[] = [];
  let recentPatternTags: string[] = [];
  let correctStreak = 0;
  const flowPrinted = new Set<string>();

  console.log('\n-- Flow coach samples --');
  let flowCount = 0;
  for (let i = 0; i < 400 && flowCount < 12; i += 1) {
    const rating = TIERS[i % TIERS.length].rating;
    const item = generateAdaptiveFlowItem(
      rating,
      used,
      prevDifficulty,
      recentTemplates,
      recentShapes,
      recentPatternTags,
      correctStreak
    );
    const key = `${item.template}:${inferFlowLabel(item)}`;
    if (flowPrinted.has(key)) continue;
    flowPrinted.add(key);
    const plan = buildFlowCoachPlan(item);
    validateCoachPlan(`flow-sample:${item.id}`, plan, failures);
    console.log(
      `  - ${item.template} | ${inferFlowLabel(item)} d=${item.difficulty} | quick="${plan.quickHint}" | steps=${plan.steps.join(' -> ')}`
    );
    flowCount += 1;

    const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
    recentTemplates = [...recentTemplates, item.template].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
    recentShapes = [...recentShapes, item.shapeSignature].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
    recentPatternTags = [...recentPatternTags, ...patternTags].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
    prevDifficulty = item.difficulty;
    used.add(item.id);
    if (item.difficulty <= rating + 25) correctStreak = Math.min(correctStreak + 1, 8);
    else correctStreak = 0;
  }

  console.log('\n-- Puzzle coach samples --');
  const puzzlePrinted = new Set<string>();
  const puzzleUsed = new Set<string>();
  let puzzlePrevDifficulty: number | undefined;
  let puzzleCount = 0;
  for (let i = 0; i < 300 && puzzleCount < 10; i += 1) {
    const rating = i % 3 === 0 ? 1050 : i % 3 === 1 ? 1250 : 1450;
    const puzzle = generateAdaptivePuzzleItem(rating, puzzleUsed, puzzlePrevDifficulty);
    puzzlePrevDifficulty = puzzle.difficulty;
    puzzleUsed.add(puzzle.id);
    if (i % 10 === 0) puzzleUsed.clear();
    const key = `${puzzle.puzzleType ?? 'unknown'}:${difficultyLabelFromScore(puzzle.difficulty)}`;
    if (puzzlePrinted.has(key)) continue;
    puzzlePrinted.add(key);
    const plan = buildPuzzleCoachPlan(puzzle);
    validateCoachPlan(`puzzle-sample:${puzzle.id}`, plan, failures);
    console.log(
      `  - ${puzzle.puzzleType ?? 'unknown'} | ${difficultyLabelFromScore(puzzle.difficulty)} d=${puzzle.difficulty} | quick="${plan.quickHint}" | steps=${plan.steps.join(' -> ')}`
    );
    puzzleCount += 1;
  }

  return { failures };
}

function runPuzzleSanity(): { failures: string[] } {
  const failures: string[] = [];
  const templateCounts: Record<string, number> = {};
  const puzzleTypeCounts: Record<string, number> = {};
  let areaYes = 0;
  let areaNo = 0;

  const bannedAlgebra = /\bn\b|n\^2|n²|n\(\s*n\s*[\+\-]\s*1\s*\)|n\(\s*n\s*-\s*1\s*\)|n\(\s*n\s*\+\s*1\s*\)/i;
  const used = new Set<string>();
  let prevDifficulty: number | undefined;

  for (let i = 0; i < PUZZLE_SANITY_COUNT; i += 1) {
    const rating = i % 3 === 0 ? 1050 : i % 3 === 1 ? 1250 : 1450;
    const puzzle = generateAdaptivePuzzleItem(rating, used, prevDifficulty) as PuzzleItem;
    prevDifficulty = puzzle.difficulty;
    used.add(puzzle.id);
    if (i % 10 === 0) used.clear();

    const template = puzzle.id.split('-')[0] ?? 'unknown';
    templateCounts[template] = (templateCounts[template] ?? 0) + 1;
    const puzzleType = puzzle.puzzleType ?? 'unknown';
    puzzleTypeCounts[puzzleType] = (puzzleTypeCounts[puzzleType] ?? 0) + 1;

    const textFields = [
      puzzle.title,
      puzzle.core_prompt,
      puzzle.core_answer,
      ...(puzzle.hint_ladder ?? []),
      ...(puzzle.solution_steps ?? [])
    ];
    if (textFields.some((field) => hasDecimal(field))) {
      failures.push(`Puzzle decimal text detected: ${puzzle.id} :: ${puzzle.core_prompt}`);
    }
    if (textFields.some((field) => bannedAlgebra.test(field))) {
      failures.push(`Banned algebra token detected: ${puzzle.id} :: ${puzzle.core_prompt}`);
    }
    if (FAST_MATH_STYLE_PUZZLE.some((pattern) => pattern.test(puzzle.core_prompt))) {
      failures.push(`Fast-math style puzzle detected: ${puzzle.id} :: ${puzzle.core_prompt}`);
    }
    if (!Array.isArray(puzzle.hint_ladder) || puzzle.hint_ladder.length !== 3) {
      failures.push(`Puzzle hints are not 3-step: ${puzzle.id}`);
    }
    if (Array.isArray(puzzle.hint_ladder)) {
      const normalizedHints = puzzle.hint_ladder.map((hint) => hint.trim().toLowerCase());
      if (new Set(normalizedHints).size !== normalizedHints.length) {
        failures.push(`Puzzle hints repeat wording: ${puzzle.id} :: ${puzzle.hint_ladder.join(' | ')}`);
      }
    }
    if (!Array.isArray(puzzle.solution_steps) || puzzle.solution_steps.length !== 3) {
      failures.push(`Puzzle Teach Me steps are not 3-step: ${puzzle.id}`);
    }
    const puzzleCoachPlan = buildPuzzleCoachPlan(puzzle);
    validateCoachPlan(`puzzle:${puzzle.id}`, puzzleCoachPlan, failures);

    if (startsWithTemplate(puzzle.id, 'spatial_area') || startsWithTemplate(puzzle.id, 'area_yn')) {
      const yesNo = puzzle.core_answer.toLowerCase();
      if (yesNo === 'yes') areaYes += 1;
      if (yesNo === 'no') areaNo += 1;
      if (/\d+\.\d+\s*×|\×\s*\d+\.\d+/.test(puzzle.core_prompt)) {
        failures.push(`Shape swap has decimal dimensions: ${puzzle.id} :: ${puzzle.core_prompt}`);
      }
    }

    if (startsWithTemplate(puzzle.id, 'stars')) {
      const nMatch = puzzle.id.match(/^stars-(\d+)-/);
      if (nMatch) {
        const n = Number(nMatch[1]);
        const expected = n % 4 === 0 ? 'no' : 'yes';
        if (puzzle.core_answer.toLowerCase() !== expected) {
          failures.push(`Stars invariant mismatch: ${puzzle.id} answered "${puzzle.core_answer}" expected "${expected}"`);
        }
      }
    }
  }

  console.log(`\n=== Puzzle Sanity (${PUZZLE_SANITY_COUNT} generated puzzles) ===`);
  printDistributionTable('Template frequency', templateCounts, PUZZLE_SANITY_COUNT);
  printDistributionTable('Puzzle type frequency', puzzleTypeCounts, PUZZLE_SANITY_COUNT);
  console.log(`\n  shape-swap split: Yes=${areaYes}, No=${areaNo}`);
  if (areaYes === 0 || areaNo === 0) {
    failures.push(`shape-swap split missing side: Yes=${areaYes}, No=${areaNo}`);
  }

  return { failures };
}

function runFractionBenchmarkLabelCheck(): { failures: string[] } {
  const raw: FlowItem = {
    id: 'verify-frac-benchmark',
    type: 'flow',
    difficulty: 0,
    template: 'fraction_compare',
    shapeSignature: 'frac_compare_pair',
    tags: ['fractions'],
    format: 'multiple_choice',
    prompt: 'Which fraction is greater? 1/2 or 3/8',
    answer: '1/2',
    choices: ['1/2', '3/8'],
    hints: ['Use a common denominator.', '1/2 = 4/8.', '4/8 is greater than 3/8.'],
    solution_steps: ['Convert 1/2 to 4/8.', 'Compare 4/8 and 3/8.', 'Answer: 1/2.']
  };
  const analyzed = analyzeFlowItem(raw);
  const label = analyzed.difficultyLabel;
  console.log(`\n=== Fraction Benchmark Label Check ===`);
  console.log(`  Prompt: ${raw.prompt}`);
  console.log(`  Computed score/label: ${analyzed.difficultyScore} / ${label}`);
  const failures: string[] = [];
  if (label === 'Hard' || label === 'Expert' || label === 'Master') {
    failures.push(`1/2 vs 3/8 labeled above Medium (${label})`);
  }
  return { failures };
}

function runTrainingModeSanity(): { failures: string[] } {
  const failures: string[] = [];
  const SIM_COUNT = isCiMode ? 8 : 20;
  const QUESTIONS_PER_SIM = 20;
  const SKILL_RATING = 1325;

  let earlyTotal = 0;
  let earlyRookieEasyMedium = 0;
  let lateTotal = 0;
  let lateHardPlus = 0;
  let maxObservedJump = 0;
  let trendDeltaTotal = 0;
  let earlyAddSubCount = 0;

  for (let sim = 0; sim < SIM_COUNT; sim += 1) {
    let trainingRating = clampTrainingRating(Math.min(SKILL_RATING, TRAINING_START_RATING), SKILL_RATING, 0);
    let trainingQuestionsAnswered = 0;
    let flowStreak = 0;
    let prevDifficulty: number | undefined;
    let recentTemplates: string[] = [];
    let recentShapes: string[] = [];
    let recentPatternTags: string[] = [];
    const used = new Set<string>();
    const firstWindow: number[] = [];
    const lateWindow: number[] = [];

    for (let i = 0; i < QUESTIONS_PER_SIM; i += 1) {
      const earlyAllowedTemplates =
        trainingQuestionsAnswered < 8
          ? ['add_sub']
          : trainingQuestionsAnswered < 12
            ? ['add_sub', 'mult_div']
            : undefined;
      const earlyMaxDifficulty =
        trainingQuestionsAnswered < 8 ? 880 : trainingQuestionsAnswered < 12 ? 950 : undefined;
      const item = generateAdaptiveFlowItem(
        trainingRating,
        used,
        prevDifficulty,
        recentTemplates,
        recentShapes,
        recentPatternTags,
        flowStreak,
        earlyMaxDifficulty,
        { targetProfile: 'training_flow', maxJumpFromPrev: 120, allowedTemplates: earlyAllowedTemplates }
      );
      const label = inferFlowLabel(item);
      if (i < 8) {
        earlyTotal += 1;
        if (label === 'Rookie' || label === 'Easy' || label === 'Medium') earlyRookieEasyMedium += 1;
      }
      if (i < 8 && item.template === 'add_sub') earlyAddSubCount += 1;
      if (i >= 12) {
        lateTotal += 1;
        if (HARD_PLUS_LABELS.has(label)) lateHardPlus += 1;
      }

      if (i < 5) firstWindow.push(item.difficulty);
      if (i >= 15) lateWindow.push(item.difficulty);

      if (prevDifficulty !== undefined) {
        const jump = Math.abs(item.difficulty - prevDifficulty);
        maxObservedJump = Math.max(maxObservedJump, jump);
        if (jump > 120) {
          failures.push(`Training jump > 120 detected (sim ${sim + 1}, q ${i + 1}): ${prevDifficulty} -> ${item.difficulty}`);
        }
      }

      const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
      recentTemplates = [...recentTemplates, item.template].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      recentShapes = [...recentShapes, item.shapeSignature].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      recentPatternTags = [...recentPatternTags, ...patternTags].slice(-FLOW_SELECTION_SETTINGS.recentHistorySize);
      prevDifficulty = item.difficulty;
      used.add(item.id);
      if (i % 10 === 0) used.clear();

      trainingQuestionsAnswered += 1;
      flowStreak = Math.min(flowStreak + 1, 8);
      trainingRating = updateTrainingRating(trainingRating, SKILL_RATING, trainingQuestionsAnswered, true, flowStreak);
    }

    const firstAvg = firstWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, firstWindow.length);
    const lateAvg = lateWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, lateWindow.length);
    trendDeltaTotal += lateAvg - firstAvg;

    const beforeWrong = trainingRating;
    trainingQuestionsAnswered += 1;
    trainingRating = updateTrainingRating(trainingRating, SKILL_RATING, trainingQuestionsAnswered, false, 0);
    trainingQuestionsAnswered += 1;
    trainingRating = updateTrainingRating(trainingRating, SKILL_RATING, trainingQuestionsAnswered, false, 0);
    if (trainingRating >= beforeWrong) {
      failures.push(`Training rating did not decrease after wrong answers (sim ${sim + 1}): ${beforeWrong} -> ${trainingRating}`);
    }
  }

  const earlyRookieEasyMediumRate = earlyTotal > 0 ? earlyRookieEasyMedium / earlyTotal : 1;
  const earlyAddSubRate = SIM_COUNT > 0 ? earlyAddSubCount / (SIM_COUNT * 8) : 1;
  const lateHardPlusRate = lateTotal > 0 ? lateHardPlus / lateTotal : 0;
  const avgTrendDelta = trendDeltaTotal / Math.max(1, SIM_COUNT);

  console.log(`\n=== Training Mode Sanity (${SIM_COUNT} sims × ${QUESTIONS_PER_SIM} correct-first questions) ===`);
  console.log(
    `  Early Rookie/Easy/Medium rate (first 8): ${(earlyRookieEasyMediumRate * 100).toFixed(2)}% (${earlyRookieEasyMedium}/${earlyTotal})`
  );
  console.log(`  Early add/sub-only rate (first 8): ${(earlyAddSubRate * 100).toFixed(2)}% (${earlyAddSubCount}/${SIM_COUNT * 8})`);
  console.log(`  Late Hard+ rate (questions 13-20): ${(lateHardPlusRate * 100).toFixed(2)}% (${lateHardPlus}/${lateTotal})`);
  console.log(`  Avg difficulty trend delta (late - early): ${avgTrendDelta.toFixed(1)}`);
  console.log(`  Max observed consecutive difficulty jump: ${maxObservedJump}`);

  if (earlyRookieEasyMediumRate < 0.9) {
    failures.push(
      `Training early cluster too hard: Rookie/Easy/Medium ${(earlyRookieEasyMediumRate * 100).toFixed(1)}%`
    );
  }
  if (earlyAddSubRate < 1) {
    failures.push(`Training first-8 questions are not strictly add/sub: ${(earlyAddSubRate * 100).toFixed(1)}% add/sub`);
  }
  if (avgTrendDelta < 80) {
    failures.push(`Training difficulty trend too flat: avg delta ${avgTrendDelta.toFixed(1)}`);
  }
  if (lateHardPlusRate < 0.05) {
    failures.push(`Training late Hard+ exposure too low: ${(lateHardPlusRate * 100).toFixed(1)}%`);
  }

  return { failures };
}

function runBonusSanity(): { failures: string[] } {
  const failures: string[] = [];
  const BONUS_COUNT = 50;
  const labelCounts: Record<string, number> = {};
  const templateCounts: Record<string, number> = {};
  const puzzleTypeCounts: Record<string, number> = {};
  const samples: string[] = [];
  let hardPlusCount = 0;
  let fastMathLikeCount = 0;

  for (let i = 0; i < BONUS_COUNT; i += 1) {
    const tier = TIERS[i % TIERS.length];
    const mode = i % 3 === 0 ? 'rocket_rush' : i % 3 === 1 ? 'puzzle_orbit' : 'galaxy_mix';
    const lastSegment = i % 2 === 0 ? 'flow' : 'puzzle';
    const runDifficulties = Array.from({ length: 8 }, (_, j) => tier.rating - 80 + j * 20);
    const { runMedianDifficulty, bonusTargetDifficulty } = buildBonusTarget(tier.rating, runDifficulties);
    const challenge: BonusChallenge = createBonusChallenge(mode, lastSegment, tier.rating, runDifficulties);

    labelCounts[challenge.label] = (labelCounts[challenge.label] ?? 0) + 1;
    templateCounts[challenge.templateKey] = (templateCounts[challenge.templateKey] ?? 0) + 1;
    puzzleTypeCounts[challenge.puzzleType] = (puzzleTypeCounts[challenge.puzzleType] ?? 0) + 1;
    if (HARD_PLUS_LABELS.has(challenge.label)) hardPlusCount += 1;
    if (FAST_MATH_STYLE_PUZZLE.some((pattern) => pattern.test(challenge.prompt))) {
      fastMathLikeCount += 1;
      failures.push(`Fast-math-like bonus detected: ${challenge.id} :: ${challenge.prompt}`);
    }

    if (samples.length < 10) {
      samples.push(
        `${String(samples.length + 1).padStart(2, '0')}. [${challenge.puzzleType}/${challenge.templateKey}] ${challenge.label} d=${challenge.difficulty} :: ${challenge.prompt}`
      );
    }
  }

  console.log(`\n=== Bonus Sanity (${BONUS_COUNT} generated bonuses) ===`);
  printDistributionTable('Bonus label distribution', labelCounts, BONUS_COUNT);
  printDistributionTable('Bonus puzzleType distribution', puzzleTypeCounts, BONUS_COUNT);
  printDistributionTable('Bonus template distribution', templateCounts, BONUS_COUNT);
  console.log(`\n  Hard+ rate: ${percent(hardPlusCount, BONUS_COUNT)}% (${hardPlusCount}/${BONUS_COUNT})`);
  console.log(`  Fast-math-like bonus rate: ${percent(fastMathLikeCount, BONUS_COUNT)}% (${fastMathLikeCount}/${BONUS_COUNT})`);
  console.log('\n  Bonus samples:');
  samples.forEach((sample) => console.log(`  ${sample}`));

  if (hardPlusCount < BONUS_COUNT * 0.8) {
    failures.push(`Bonus Hard+ rate below threshold: ${hardPlusCount}/${BONUS_COUNT}`);
  }
  if (fastMathLikeCount > 0) {
    failures.push(`Fast-math-like bonus prompts detected: ${fastMathLikeCount}/${BONUS_COUNT}`);
  }

  return { failures };
}

function main(): void {
  console.log(`verify:gen mode = ${isCiMode ? 'ci' : 'full'}`);
  printFlowTemplateCatalog();
  printAdaptiveInputsAndFormula();

  const flowStats = runFlowDistributionAndAssertions();
  const flowSamples = printFlowSamples();
  const rookieSamples = printRookieSamples();
  const coachSamples = printCoachSamples();
  const fractionBenchmarkCheck = runFractionBenchmarkLabelCheck();
  const trainingStats = runTrainingModeSanity();
  const puzzleStats = runPuzzleSanity();
  const bonusStats = runBonusSanity();
  const failures = [
    ...flowStats.failures,
    ...flowSamples.failures,
    ...rookieSamples.failures,
    ...coachSamples.failures,
    ...fractionBenchmarkCheck.failures,
    ...trainingStats.failures,
    ...puzzleStats.failures,
    ...bonusStats.failures
  ];

  if (failures.length > 0) {
    console.error('\n=== Verification Failures ===');
    failures.slice(0, 40).forEach((f, index) => {
      console.error(`  ${index + 1}. ${f}`);
    });
    if (failures.length > 40) {
      console.error(`  ...and ${failures.length - 40} more`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nAll generator verification checks passed.');
}

main();

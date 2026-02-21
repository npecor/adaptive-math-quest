import { FLOW_SELECTION_SETTINGS, FLOW_TARGET_DISTRIBUTION } from '../src/lib/adaptive';
import { buildBonusTarget, createBonusChallenge, type BonusChallenge } from '../src/lib/bonus-generator';
import { analyzeFlowItem, difficultyLabelFromScore, type DifficultyLabel } from '../src/lib/difficulty-tags';
import { FLOW_TEMPLATE_CATALOG, generateAdaptiveFlowItem } from '../src/lib/flow-generator';
import { generateAdaptivePuzzleItem } from '../src/lib/puzzle-generator';
import type { FlowItem, PuzzleItem } from '../src/lib/types';

const TIERS = [
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
const gcdNumber = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcdNumber(b, a % b));
const FAST_MATH_STYLE_PUZZLE = [
  /which is (bigger|greater).*\d+\/\d+/i,
  /x\s*[+\-*/÷×]\s*\d+\s*=\s*-?\d+/i,
  /which is closest to/i,
  /^\s*(solve|what is)\s*:\s*\d+\s*[+\-×x÷]\s*\d+/i
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
      if (!hasConcreteRewriteHint(item)) {
        failures.push(`Missing concrete rewrite hint for ${item.id}: ${item.hints.join(' | ')}`);
      }

      const addSub = parseAddSub(item.prompt);
      if (addSub?.op === '-') {
        subtractionCount += 1;
        if (Number(item.answer) < 0) easyNegativeSubtractions += 1;
      }

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
      `\n  Easy-negative-subtraction rate: ${subtractionCount ? percent(easyNegativeSubtractions, subtractionCount) : '0.00'}% (${easyNegativeSubtractions}/${subtractionCount})`
    );
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
    if (tier.name === 'Easy' && easyNegativeSubtractions > 0) {
      failures.push(`Easy tier produced ${easyNegativeSubtractions} negative subtraction answers.`);
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

function runPuzzleSanity(): { failures: string[] } {
  const failures: string[] = [];
  const templateCounts: Record<string, number> = {};
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

    if (startsWithTemplate(puzzle.id, 'area_yn')) {
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
  console.log(`\n  area_yn split: Yes=${areaYes}, No=${areaNo}`);
  if (areaYes === 0 || areaNo === 0) {
    failures.push(`area_yn split missing side: Yes=${areaYes}, No=${areaNo}`);
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

function runBonusSanity(): { failures: string[] } {
  const failures: string[] = [];
  const BONUS_COUNT = 100;
  const labelCounts: Record<string, number> = {};
  const templateCounts: Record<string, number> = {};
  let hardPlusCount = 0;
  let aboveMedianCount = 0;
  let hardPlusOrAboveCount = 0;

  for (let i = 0; i < BONUS_COUNT; i += 1) {
    const tier = TIERS[i % TIERS.length];
    const mode = i % 3 === 0 ? 'rocket_rush' : i % 3 === 1 ? 'puzzle_orbit' : 'galaxy_mix';
    const lastSegment = i % 2 === 0 ? 'flow' : 'puzzle';
    const runDifficulties = Array.from({ length: 8 }, (_, j) => tier.rating - 80 + j * 20);
    const { runMedianDifficulty, bonusTargetDifficulty } = buildBonusTarget(tier.rating, runDifficulties);
    const challenge: BonusChallenge = createBonusChallenge(mode, lastSegment, tier.rating, runDifficulties);

    labelCounts[challenge.label] = (labelCounts[challenge.label] ?? 0) + 1;
    templateCounts[challenge.templateKey] = (templateCounts[challenge.templateKey] ?? 0) + 1;
    if (HARD_PLUS_LABELS.has(challenge.label)) hardPlusCount += 1;
    if (challenge.difficulty >= runMedianDifficulty + 70) aboveMedianCount += 1;
    if (HARD_PLUS_LABELS.has(challenge.label) || challenge.difficulty >= runMedianDifficulty + 70) {
      hardPlusOrAboveCount += 1;
    }

    if (challenge.templateKey === 'fraction_compare') {
      const prompt = challenge.prompt;
      const match = prompt.match(/(\d+)\/(\d+)\s+or\s+(\d+)\/(\d+)/i);
      if (!match) failures.push(`Fraction bonus prompt format mismatch: ${challenge.id} :: ${prompt}`);
      else {
        const d1 = Number(match[2]);
        const d2 = Number(match[4]);
        const sharedLcm = Math.abs(d1 * d2) / Math.max(1, gcdNumber(d1, d2));
        if (sharedLcm <= 24) failures.push(`Fraction bonus LCM too small (${sharedLcm}) for ${challenge.id}`);
        if (d1 % d2 === 0 || d2 % d1 === 0) failures.push(`Fraction bonus denominators are multiples (${d1}, ${d2}) for ${challenge.id}`);
      }
    }
  }

  console.log(`\n=== Bonus Sanity (${BONUS_COUNT} generated bonuses) ===`);
  printDistributionTable('Bonus label distribution', labelCounts, BONUS_COUNT);
  printDistributionTable('Bonus template distribution', templateCounts, BONUS_COUNT);
  console.log(`\n  Hard+ rate: ${percent(hardPlusCount, BONUS_COUNT)}% (${hardPlusCount}/${BONUS_COUNT})`);
  console.log(
    `  Above run-median+70 rate: ${percent(aboveMedianCount, BONUS_COUNT)}% (${aboveMedianCount}/${BONUS_COUNT})`
  );
  console.log(
    `  Hard+ OR above-median+70 rate: ${percent(hardPlusOrAboveCount, BONUS_COUNT)}% (${hardPlusOrAboveCount}/${BONUS_COUNT})`
  );

  if (hardPlusCount < BONUS_COUNT * 0.8) {
    failures.push(`Bonus Hard+ rate below threshold: ${hardPlusCount}/${BONUS_COUNT}`);
  }
  if (hardPlusOrAboveCount < BONUS_COUNT * 0.8) {
    failures.push(`Bonus Hard+/above-median combined rate below threshold: ${hardPlusOrAboveCount}/${BONUS_COUNT}`);
  }

  return { failures };
}

function main(): void {
  console.log(`verify:gen mode = ${isCiMode ? 'ci' : 'full'}`);
  printFlowTemplateCatalog();
  printAdaptiveInputsAndFormula();

  const flowStats = runFlowDistributionAndAssertions();
  const flowSamples = printFlowSamples();
  const fractionBenchmarkCheck = runFractionBenchmarkLabelCheck();
  const puzzleStats = runPuzzleSanity();
  const bonusStats = runBonusSanity();
  const failures = [
    ...flowStats.failures,
    ...flowSamples.failures,
    ...fractionBenchmarkCheck.failures,
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

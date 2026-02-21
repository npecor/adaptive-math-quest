import type { FlowItem } from './types';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export type TargetDifficultyProfile = 'default' | 'training_flow' | 'training_puzzle';
export const TRAINING_RATING_MIN = 800;
export const TRAINING_START_RATING = 850;
export const TRAINING_EARLY_QUESTION_CAP = 8;
export const TRAINING_EARLY_BUFFER = 40;
export const TRAINING_BASE_UP = 10;
export const TRAINING_STREAK_BONUS = 6;
export const TRAINING_DOWN = 18;

export const FLOW_TARGET_DISTRIBUTION = {
  base: {
    near: 0.6,
    above: 0.25,
    below: 0.15,
    centerShift: 0,
    nearSd: 50,
    aboveRange: [50, 140] as const,
    belowRange: [-120, -50] as const
  },
  streak: {
    trigger: 4,
    near: 0.45,
    above: 0.45,
    below: 0.1,
    centerShift: 40,
    nearSd: 45,
    aboveRange: [50, 140] as const,
    belowRange: [-120, -50] as const
  }
} as const;

export const TRAINING_TARGET_DISTRIBUTION = {
  flow: {
    near: 0.8,
    above: 0.15,
    below: 0.05,
    centerShift: 0,
    nearSd: 35,
    aboveRange: [20, 60] as const,
    belowRange: [-60, -20] as const
  },
  puzzle: {
    near: 0.82,
    above: 0.13,
    below: 0.05,
    centerShift: 0,
    nearSd: 30,
    aboveRange: [15, 45] as const,
    belowRange: [-45, -15] as const
  }
} as const;

export const FLOW_SELECTION_SETTINGS = {
  candidateCount: 24,
  topPoolSize: 5,
  recentHistorySize: 6,
  jumpPenalty: {
    freeWindow: 90,
    multiplier: 3
  },
  diversityPenalty: {
    templateLast2: 40,
    templateLast4: 20,
    shapeLast2: 30,
    patternLast3: 25
  }
} as const;

export const expectedProbability = (rating: number, difficulty: number) =>
  1 / (1 + 10 ** ((difficulty - rating) / 400));

export function updateRating(
  rating: number,
  difficulty: number,
  correct: boolean,
  attemptsCount: number,
  correctStreak = 0
): number {
  void attemptsCount;
  const p = expectedProbability(rating, difficulty);
  const k = correctStreak >= 5 ? 18 : correctStreak >= 3 ? 12 : 8;
  const rawDelta = k * ((correct ? 1 : 0) - p);
  const delta = clamp(rawDelta, -26, 26);
  return rating + delta;
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const gaussian = (mean: number, sd: number) => {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
};

export function chooseTargetDifficulty(
  rating: number,
  correctStreak = 0,
  profile: TargetDifficultyProfile = 'default'
): number {
  if (profile === 'training_flow' || profile === 'training_puzzle') {
    const config = profile === 'training_flow' ? TRAINING_TARGET_DISTRIBUTION.flow : TRAINING_TARGET_DISTRIBUTION.puzzle;
    const center = rating + config.centerShift;
    const roll = Math.random();
    if (roll < config.near) return gaussian(center, config.nearSd);
    if (roll < config.near + config.above) {
      return randomBetween(center + config.aboveRange[0], center + config.aboveRange[1]);
    }
    return randomBetween(center + config.belowRange[0], center + config.belowRange[1]);
  }

  const streaking = correctStreak >= FLOW_TARGET_DISTRIBUTION.streak.trigger;
  const config = streaking ? FLOW_TARGET_DISTRIBUTION.streak : FLOW_TARGET_DISTRIBUTION.base;
  const center = rating + config.centerShift;
  const nearProbability = config.near;
  const aboveProbability = config.above;
  const belowProbability = config.below;
  const roll = Math.random();
  void belowProbability;
  if (roll < nearProbability) return gaussian(center, config.nearSd);
  if (roll < nearProbability + aboveProbability) {
    return randomBetween(center + config.aboveRange[0], center + config.aboveRange[1]);
  }
  return randomBetween(center + config.belowRange[0], center + config.belowRange[1]);
}

const getTrainingUpperCap = (skillRating: number, questionsAnswered: number) => {
  if (questionsAnswered < TRAINING_EARLY_QUESTION_CAP && skillRating > TRAINING_RATING_MIN + TRAINING_EARLY_BUFFER) {
    return skillRating - TRAINING_EARLY_BUFFER;
  }
  return skillRating;
};

export const clampTrainingRating = (value: number, skillRating: number, questionsAnswered: number) =>
  clamp(value, TRAINING_RATING_MIN, getTrainingUpperCap(skillRating, questionsAnswered));

export const updateTrainingRating = (
  currentTrainingRating: number,
  skillRating: number,
  questionsAnswered: number,
  correct: boolean,
  flowStreak: number
) => {
  const up = TRAINING_BASE_UP + (flowStreak >= 5 ? TRAINING_STREAK_BONUS : 0);
  const nextRaw = correct ? currentTrainingRating + up : currentTrainingRating - TRAINING_DOWN;
  return clampTrainingRating(nextRaw, skillRating, questionsAnswered);
};

export const trimRecentHistory = (history: string[], max = FLOW_SELECTION_SETTINGS.recentHistorySize) => history.slice(-max);

export function getFlowDiversityPenalty(
  item: FlowItem,
  recentTemplates: string[],
  recentShapes: string[],
  recentPatternTags: string[] = []
): number {
  let penalty = 0;
  const recentTemplate2 = recentTemplates.slice(-2);
  const recentTemplate4 = recentTemplates.slice(-4);
  const recentShape2 = recentShapes.slice(-2);
  const recentPattern3 = recentPatternTags.slice(-3);

  if (recentTemplate2.includes(item.template)) penalty += FLOW_SELECTION_SETTINGS.diversityPenalty.templateLast2;
  else if (recentTemplate4.includes(item.template)) penalty += FLOW_SELECTION_SETTINGS.diversityPenalty.templateLast4;
  if (recentShape2.includes(item.shapeSignature)) penalty += FLOW_SELECTION_SETTINGS.diversityPenalty.shapeLast2;
  const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
  if (patternTags.some((tag) => recentPattern3.includes(tag))) penalty += FLOW_SELECTION_SETTINGS.diversityPenalty.patternLast3;
  return penalty;
}

export function selectNextFlowItem(
  items: FlowItem[],
  rating: number,
  usedIds: Set<string>,
  prevDifficulty?: number
): FlowItem {
  const pool = items.filter((item) => !usedIds.has(item.id));
  const target = chooseTargetDifficulty(rating);
  const withPenalty = pool.map((item) => {
    const jumpPenalty = prevDifficulty === undefined ? 0 : Math.max(0, Math.abs(item.difficulty - prevDifficulty) - 80) * 4;
    return { item, score: Math.abs(item.difficulty - target) + jumpPenalty };
  });

  withPenalty.sort((a, b) => a.score - b.score);
  const candidatePool = withPenalty.slice(0, Math.min(4, withPenalty.length));
  const pick = candidatePool[Math.floor(Math.random() * candidatePool.length)];
  return pick?.item ?? items[0];
}

import type { FlowItem } from './types';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const expectedProbability = (rating: number, difficulty: number) =>
  1 / (1 + 10 ** ((difficulty - rating) / 400));

export function updateRating(
  rating: number,
  difficulty: number,
  correct: boolean,
  attemptsCount: number,
  correctStreak = 0
): number {
  const p = expectedProbability(rating, difficulty);
  const earlyK = attemptsCount < 10 ? 20 : attemptsCount < 20 ? 16 : attemptsCount < 30 ? 13 : 10;
  const streakBoost = correct ? Math.min(6, Math.max(0, correctStreak - 2)) : 0;
  const k = earlyK + streakBoost;
  const rawDelta = k * ((correct ? 1 : 0) - p);
  const delta = clamp(rawDelta, -30, 30);
  return rating + delta;
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const gaussian = (mean: number, sd: number) => {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
};

export function chooseTargetDifficulty(rating: number, correctStreak = 0): number {
  const streakShift = correctStreak >= 5 ? Math.min(120, (correctStreak - 4) * 12) : 0;
  const center = rating + streakShift;
  const aboveProbability = correctStreak >= 5 ? 0.38 : 0.25;
  const belowProbability = correctStreak >= 5 ? 0.07 : 0.15;
  const nearProbability = 1 - aboveProbability - belowProbability;
  const roll = Math.random();
  if (roll < nearProbability) return gaussian(center, correctStreak >= 5 ? 45 : 50);
  if (roll < nearProbability + aboveProbability) return randomBetween(center + 50, center + 140);
  return randomBetween(center - 120, center - 50);
}

export const trimRecentHistory = (history: string[], max = 6) => history.slice(-max);

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

  if (recentTemplate2.includes(item.template)) penalty += 40;
  else if (recentTemplate4.includes(item.template)) penalty += 20;
  if (recentShape2.includes(item.shapeSignature)) penalty += 30;
  const patternTags = item.tags.filter((tag) => tag.startsWith('pattern:'));
  if (patternTags.some((tag) => recentPattern3.includes(tag))) penalty += 25;
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

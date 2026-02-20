import type { FlowItem } from './types';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const expectedProbability = (rating: number, difficulty: number) =>
  1 / (1 + 10 ** ((difficulty - rating) / 400));

export function updateRating(rating: number, difficulty: number, correct: boolean, attemptsCount: number): number {
  const p = expectedProbability(rating, difficulty);
  const k = attemptsCount < 15 ? 6 : 10;
  const rawDelta = k * ((correct ? 1 : 0) - p);
  const delta = clamp(rawDelta, -25, 25);
  return rating + delta;
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);
const gaussian = (mean: number, sd: number) => {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
};

export function chooseTargetDifficulty(rating: number): number {
  const roll = Math.random();
  if (roll < 0.6) return gaussian(rating, 50);
  if (roll < 0.85) return randomBetween(rating + 50, rating + 120);
  return randomBetween(rating - 120, rating - 50);
}

export const trimRecentHistory = (history: string[], max = 6) => history.slice(-max);

export function getFlowDiversityPenalty(item: FlowItem, recentTemplates: string[], recentShapes: string[]): number {
  let penalty = 0;
  const recentTemplate2 = recentTemplates.slice(-2);
  const recentTemplate4 = recentTemplates.slice(-4);
  const recentShape2 = recentShapes.slice(-2);

  if (recentTemplate2.includes(item.template)) penalty += 40;
  else if (recentTemplate4.includes(item.template)) penalty += 20;
  if (recentShape2.includes(item.shapeSignature)) penalty += 30;
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

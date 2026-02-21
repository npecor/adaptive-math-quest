import {
  buildSortQuery,
  ensureBots,
  getSupabase,
  normalizeBestRunScores,
  parseLimit,
  parseMode,
  setCors,
  toApiRow
} from './_lib/leaderboard.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  try {
    const mode = parseMode(req.query?.mode);
    const limit = parseLimit(req.query?.limit, 50);

    const supabase = await getSupabase();
    await normalizeBestRunScores(supabase);
    await ensureBots(supabase);
    const { data, error } = await buildSortQuery(supabase, mode, limit);
    if (error) throw error;

    const rows = (data ?? []).map((player: any, index: number) => toApiRow(player, index + 1));
    return res.status(200).json({ rows });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'leaderboard fetch failed' });
  }
}

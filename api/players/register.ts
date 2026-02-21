import {
  cleanUsername,
  dedupeUsername,
  getPlayerById,
  getSupabase,
  parseBody,
  resolveUserId,
  setCors
} from '../_lib/leaderboard';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const body = parseBody(req);
    const usernameRaw = body?.username;
    const avatarIdRaw = body?.avatarId;
    if (typeof usernameRaw !== 'string' || !usernameRaw.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (typeof avatarIdRaw !== 'string' || !avatarIdRaw.trim()) {
      return res.status(400).json({ error: 'avatarId is required' });
    }

    const supabase = getSupabase();
    const resolvedUserId = resolveUserId(body?.userId);
    const existing = await getPlayerById(supabase, resolvedUserId);
    const { username, usernameKey, deduped } = await dedupeUsername(supabase, usernameRaw, resolvedUserId);
    const now = new Date().toISOString();

    const allTime = Math.max(0, Math.floor(Number(existing?.all_time_stars ?? existing?.high_score ?? 0)));
    const bestRun = Math.max(0, Math.floor(Number(existing?.best_run_stars ?? existing?.high_score ?? 0)));
    const trophies = Math.max(0, Math.floor(Number(existing?.trophies_earned ?? 0)));
    const extensions = Math.max(0, Math.floor(Number(existing?.extensions_solved ?? 0)));

    const nextRow = {
      user_id: resolvedUserId,
      username,
      username_key: usernameKey,
      avatar_id: avatarIdRaw.trim(),
      all_time_stars: allTime,
      best_run_stars: bestRun,
      trophies_earned: trophies,
      extensions_solved: extensions,
      high_score: allTime,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      is_bot: false
    };

    const { error } = await supabase.from('leaderboard_players').upsert(nextRow, { onConflict: 'user_id' });
    if (error) throw error;

    return res.status(200).json({
      userId: resolvedUserId,
      username,
      avatarId: avatarIdRaw.trim(),
      createdAt: nextRow.created_at,
      updatedAt: now,
      deduped
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'register failed' });
  }
}

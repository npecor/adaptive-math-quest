import {
  dedupeUsername,
  getPlayerById,
  getSupabase,
  parseBody,
  resolveUserId,
  setCors,
  toApiRow
} from '../_lib/leaderboard.js';

export const config = { runtime: 'nodejs' };
const MAX_REASONABLE_RUN_STARS = 660;

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    const body = parseBody(req);
    const userId = resolveUserId(body?.userId);
    const usernameRaw = body?.username;
    const avatarIdRaw = body?.avatarId;

    if (typeof usernameRaw !== 'string' || !usernameRaw.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (typeof avatarIdRaw !== 'string' || !avatarIdRaw.trim()) {
      return res.status(400).json({ error: 'avatarId is required' });
    }

    const legacyScore = Number(body?.score);
    const hasLegacyScore = Number.isFinite(legacyScore) && legacyScore >= 0;

    const numericAllTimeStars = Number(body?.allTimeStars);
    const numericBestRunStars = Number(body?.bestRunStars);
    const numericTrophiesEarned = Number(body?.trophiesEarned);
    const numericExtensionsSolved = Number(body?.extensionsSolved);
    const hasNewPayload =
      Number.isFinite(numericAllTimeStars) &&
      numericAllTimeStars >= 0 &&
      Number.isFinite(numericBestRunStars) &&
      numericBestRunStars >= 0 &&
      Number.isFinite(numericTrophiesEarned) &&
      numericTrophiesEarned >= 0 &&
      Number.isFinite(numericExtensionsSolved) &&
      numericExtensionsSolved >= 0;

    if (!hasNewPayload && !hasLegacyScore) {
      return res.status(400).json({ error: 'payload must include score or all-time fields' });
    }

    const supabase = await getSupabase();
    const existing = await getPlayerById(supabase, userId);
    const { username, usernameKey } = await dedupeUsername(supabase, usernameRaw, userId);
    const now = new Date().toISOString();

    const incomingAllTime = Math.max(0, Math.floor(hasNewPayload ? numericAllTimeStars : legacyScore));
    const incomingBestRun = Math.max(0, Math.floor(hasNewPayload ? numericBestRunStars : legacyScore));
    const incomingTrophies = Math.max(0, Math.floor(hasNewPayload ? numericTrophiesEarned : 0));
    const incomingExtensions = Math.max(0, Math.floor(hasNewPayload ? numericExtensionsSolved : 0));

    const resolvedAllTimeStars = Math.max(existing?.all_time_stars ?? existing?.high_score ?? 0, incomingAllTime);
    // For the new payload, trust client best-run as source-of-truth (clamped),
    // so legacy inflated values can be corrected downward.
    const resolvedBestRunStars = hasNewPayload
      ? Math.max(0, Math.min(incomingBestRun, resolvedAllTimeStars, MAX_REASONABLE_RUN_STARS))
      : Math.max(
          0,
          Math.min(
            Math.max(existing?.best_run_stars ?? existing?.high_score ?? 0, incomingBestRun),
            resolvedAllTimeStars,
            MAX_REASONABLE_RUN_STARS
          )
        );
    const resolvedTrophiesEarned = Math.max(existing?.trophies_earned ?? 0, incomingTrophies);
    const resolvedExtensionsSolved = Math.max(existing?.extensions_solved ?? 0, incomingExtensions);

    const nextRow = {
      user_id: userId,
      username,
      username_key: usernameKey,
      avatar_id: avatarIdRaw.trim(),
      all_time_stars: resolvedAllTimeStars,
      best_run_stars: resolvedBestRunStars,
      trophies_earned: resolvedTrophiesEarned,
      extensions_solved: resolvedExtensionsSolved,
      high_score: resolvedAllTimeStars,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      is_bot: existing?.is_bot ?? false
    };

    const { error } = await supabase.from('leaderboard_players').upsert(nextRow, { onConflict: 'user_id' });
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      row: {
        ...toApiRow(nextRow as any, 0),
        score: resolvedAllTimeStars
      }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'upsert failed' });
  }
}

type SupabaseClient = any;

export type LeaderboardMode = 'all_time' | 'best_run' | 'trophies';
export const MAX_REASONABLE_RUN_STARS = 660;

type DbPlayer = {
  user_id: string;
  username: string;
  username_key: string;
  avatar_id: string;
  all_time_stars: number;
  best_run_stars: number;
  trophies_earned: number;
  extensions_solved: number;
  high_score: number;
  created_at: string;
  updated_at: string;
  is_bot: boolean;
};

const TABLE = 'leaderboard_players';
const CORS_ORIGIN = process.env.LEADERBOARD_CORS_ORIGIN || '*';

const DEFAULT_BOTS: Array<Omit<DbPlayer, 'username_key' | 'created_at' | 'updated_at'>> = [
  {
    user_id: 'bot-nova',
    username: 'Nova',
    avatar_id: 'animal-axo-naut',
    all_time_stars: 476,
    best_run_stars: 188,
    trophies_earned: 6,
    extensions_solved: 5,
    high_score: 476,
    is_bot: true
  },
  {
    user_id: 'bot-cyber',
    username: 'Cyber',
    avatar_id: 'astro-bot',
    all_time_stars: 412,
    best_run_stars: 172,
    trophies_earned: 5,
    extensions_solved: 4,
    high_score: 412,
    is_bot: true
  },
  {
    user_id: 'bot-cometx',
    username: 'Comet_X',
    avatar_id: 'animal-stardust-fish',
    all_time_stars: 338,
    best_run_stars: 149,
    trophies_earned: 3,
    extensions_solved: 2,
    high_score: 338,
    is_bot: true
  }
];

let supabaseClient: SupabaseClient | null = null;
let supabaseCreateClient: ((url: string, key: string, options?: any) => SupabaseClient) | null = null;

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const getSupabase = async (): Promise<SupabaseClient> => {
  if (supabaseClient) return supabaseClient;
  if (!supabaseCreateClient) {
    const supabaseModule = await import('@supabase/supabase-js');
    supabaseCreateClient = supabaseModule.createClient;
  }
  const url = required('SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  supabaseClient = supabaseCreateClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseClient;
};

export const setCors = (res: any) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export const cleanUsername = (value: string) => value.trim().replace(/\s+/g, ' ');
export const normalizeUsernameKey = (value: string) => cleanUsername(value).toLowerCase();

export const parseMode = (value: unknown): LeaderboardMode =>
  value === 'best_run' || value === 'trophies' ? value : 'all_time';

export const parseLimit = (value: unknown, fallback = 50) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(numeric)));
};

export const parseBody = (req: any) => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
};

export const toApiRow = (player: DbPlayer, rank: number) => ({
  rank,
  userId: player.user_id,
  username: player.username,
  avatarId: player.avatar_id,
  allTimeStars: player.all_time_stars ?? player.high_score ?? 0,
  bestRunStars: player.best_run_stars ?? player.high_score ?? 0,
  trophiesEarned: player.trophies_earned ?? 0,
  extensionsSolved: player.extensions_solved ?? 0,
  updatedAt: player.updated_at,
  isBot: Boolean(player.is_bot)
});

export const getPlayerById = async (supabase: SupabaseClient, userId: string): Promise<DbPlayer | null> => {
  const { data, error } = await supabase.from(TABLE).select('*').eq('user_id', userId).maybeSingle<DbPlayer>();
  if (error) throw error;
  return data ?? null;
};

const isUsernameAvailable = async (supabase: SupabaseClient, usernameKey: string, userId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from(TABLE)
    .select('user_id')
    .eq('username_key', usernameKey)
    .maybeSingle<{ user_id: string }>();
  if (error) throw error;
  return !data || data.user_id === userId;
};

export const dedupeUsername = async (
  supabase: SupabaseClient,
  requestedUsername: string,
  userId: string
): Promise<{ username: string; usernameKey: string; deduped: boolean }> => {
  const baseName = cleanUsername(requestedUsername);
  let candidate = baseName;
  for (let counter = 1; counter < 10000; counter += 1) {
    const candidateKey = normalizeUsernameKey(candidate);
    if (await isUsernameAvailable(supabase, candidateKey, userId)) {
      return { username: candidate, usernameKey: candidateKey, deduped: counter > 1 };
    }
    candidate = `${baseName} ${counter + 1}`;
  }
  const fallback = `${baseName}-${Date.now()}`;
  return {
    username: fallback,
    usernameKey: normalizeUsernameKey(fallback),
    deduped: true
  };
};

export const ensureBots = async (supabase: SupabaseClient) => {
  const botIds = DEFAULT_BOTS.map((bot) => bot.user_id);
  const { data, error } = await supabase.from(TABLE).select('user_id').in('user_id', botIds);
  if (error) throw error;
  const existingIds = new Set((data ?? []).map((row: { user_id: string }) => row.user_id));
  const now = new Date().toISOString();
  const missing = DEFAULT_BOTS.filter((bot) => !existingIds.has(bot.user_id)).map((bot) => ({
    ...bot,
    username_key: normalizeUsernameKey(bot.username),
    created_at: now,
    updated_at: now
  }));
  if (missing.length === 0) return;
  const { error: insertError } = await supabase.from(TABLE).insert(missing);
  if (insertError) throw insertError;
};

export const normalizeBestRunScores = async (supabase: SupabaseClient) => {
  const { data, error } = await supabase.from(TABLE).select('user_id,best_run_stars,all_time_stars');
  if (error) throw error;
  if (!data?.length) return;

  const updates = data
    .map((row: { user_id: string; best_run_stars?: number; all_time_stars?: number }) => {
      const current = Math.max(0, Math.floor(Number(row.best_run_stars ?? 0)));
      const allTime = Math.max(0, Math.floor(Number(row.all_time_stars ?? 0)));
      const normalized = Math.min(current, allTime, MAX_REASONABLE_RUN_STARS);
      if (normalized === current) return null;
      return { user_id: row.user_id, best_run_stars: normalized };
    })
    .filter((row): row is { user_id: string; best_run_stars: number } => Boolean(row));

  if (updates.length === 0) return;
  await Promise.all(
    updates.map(async (row) => {
      const { error: updateError } = await supabase
        .from(TABLE)
        .update({ best_run_stars: row.best_run_stars })
        .eq('user_id', row.user_id);
      if (updateError) throw updateError;
    })
  );
};

export const buildSortQuery = (supabase: SupabaseClient, mode: LeaderboardMode, limit: number) => {
  let query = supabase.from(TABLE).select('*').limit(limit);
  if (mode === 'best_run') {
    query = query
      .gt('best_run_stars', 0)
      .order('best_run_stars', { ascending: false })
      .order('all_time_stars', { ascending: false });
  } else if (mode === 'trophies') {
    query = query
      .gt('trophies_earned', 0)
      .order('trophies_earned', { ascending: false })
      .order('extensions_solved', { ascending: false })
      .order('all_time_stars', { ascending: false });
  } else {
    query = query
      .gt('all_time_stars', 0)
      .order('all_time_stars', { ascending: false })
      .order('best_run_stars', { ascending: false });
  }
  return query.order('updated_at', { ascending: true });
};

const fallbackUuid = () => `uid-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

export const resolveUserId = (requestedUserId?: unknown) => {
  if (typeof requestedUserId === 'string' && requestedUserId.trim()) return requestedUserId.trim();
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return fallbackUuid();
};

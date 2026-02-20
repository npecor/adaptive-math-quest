export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  avatarId: string;
  allTimeStars: number;
  bestRunStars: number;
  trophiesEarned: number;
  extensionsSolved: number;
  updatedAt: string;
  isBot?: boolean;
}

export type LeaderboardMode = 'all_time' | 'best_run' | 'trophies';

interface RegisterPlayerRequest {
  username: string;
  avatarId: string;
  userId?: string;
}

interface RegisterPlayerResponse {
  userId: string;
  username: string;
  avatarId: string;
  createdAt: string;
  updatedAt: string;
  deduped: boolean;
}

interface UpsertScoreRequest {
  userId: string;
  username: string;
  avatarId: string;
  allTimeStars: number;
  bestRunStars: number;
  trophiesEarned: number;
  extensionsSolved: number;
}

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const API_BASE_URL = env?.VITE_LEADERBOARD_BASE_URL?.replace(/\/+$/, '') ?? '';

const withBaseUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
};

const jsonRequest = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
};

export const registerPlayer = async (payload: RegisterPlayerRequest): Promise<RegisterPlayerResponse> =>
  jsonRequest<RegisterPlayerResponse>(withBaseUrl('/api/players/register'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const upsertScore = async (payload: UpsertScoreRequest): Promise<void> => {
  await jsonRequest<{ ok: boolean }>(withBaseUrl('/api/scores/upsert'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const fetchLeaderboard = async (mode: LeaderboardMode = 'all_time', limit = 50): Promise<LeaderboardRow[]> => {
  const data = await jsonRequest<{ rows: LeaderboardRow[] }>(withBaseUrl(`/api/leaderboard?mode=${mode}&limit=${limit}`));
  return data.rows;
};

export const fetchLeaderboardHealth = async (): Promise<boolean> => {
  const data = await jsonRequest<{ ok: boolean }>(withBaseUrl('/api/health'));
  return Boolean(data.ok);
};

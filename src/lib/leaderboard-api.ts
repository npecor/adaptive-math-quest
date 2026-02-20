export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  avatarId: string;
  score: number;
  updatedAt: string;
  isBot?: boolean;
}

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
  score: number;
}

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
  jsonRequest<RegisterPlayerResponse>('/api/players/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const upsertScore = async (payload: UpsertScoreRequest): Promise<void> => {
  await jsonRequest<{ ok: boolean }>('/api/scores/upsert', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const fetchLeaderboard = async (limit = 50): Promise<LeaderboardRow[]> => {
  const data = await jsonRequest<{ rows: LeaderboardRow[] }>(`/api/leaderboard?limit=${limit}`);
  return data.rows;
};

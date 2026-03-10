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

export type MatchStatus = 'waiting' | 'ready' | 'started' | 'finished';

export interface MatchConfig {
  gameMode: 'galaxy_mix';
  flowTarget: number;
  puzzleTarget: number;
}

export interface MatchResults {
  winnerPlayerId: string;
  players: Array<{
    playerId: string;
    scoreStars: number;
    correctCount: number;
    totalCount: number;
    timeMs: number;
    accuracy: number;
    submittedAt: string;
  }>;
  tiebreakUsed: 'score' | 'accuracy' | 'time';
}

export interface MatchSnapshot {
  matchId: string;
  status: MatchStatus;
  hostPlayerId: string | null;
  hostUsername: string | null;
  guestPlayerId: string | null;
  guestUsername: string | null;
  startAt: number | null;
  avgRatingLocked: number | null;
  seedLocked: number | null;
  challengeConfig: MatchConfig | null;
  results: MatchResults | null;
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
  allTimeStars: number;
  bestRunStars: number;
  trophiesEarned: number;
  extensionsSolved: number;
}

interface MatchCreateRequest {
  hostPlayerId: string;
}

interface MatchCreateResponse {
  matchId: string;
  joinUrl: string;
}

interface MatchJoinRequest {
  matchId: string;
  joinToken: string;
  guestPlayerId: string;
}

interface MatchJoinResponse {
  status: 'ready';
}

interface MatchStartRequest {
  matchId: string;
  hostPlayerId: string;
}

interface MatchStartResponse {
  startAt: number;
  avgRatingLocked: number;
  seedLocked: number;
  challengeConfig: MatchConfig;
}

interface MatchSubmitRequest {
  matchId: string;
  playerId: string;
  scoreStars: number;
  correctCount: number;
  totalCount: number;
  timeMs: number;
}

interface MatchSubmitResponse {
  status: MatchStatus;
  resultsIfFinished: MatchResults | null;
}

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
const API_BASE_URL = env?.VITE_LEADERBOARD_BASE_URL?.replace(/\/+$/, '') ?? '';

const withBaseUrl = (path: string) => {
  if (!API_BASE_URL) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
};

const LEADERBOARD_REQUEST_TIMEOUT_MS = 12000;

const jsonRequest = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), LEADERBOARD_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      },
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

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

export const createMatch = async (payload: MatchCreateRequest): Promise<MatchCreateResponse> =>
  jsonRequest<MatchCreateResponse>(withBaseUrl('/api/match/create'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const joinMatch = async (payload: MatchJoinRequest): Promise<MatchJoinResponse> =>
  jsonRequest<MatchJoinResponse>(withBaseUrl('/api/match/join'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const startMatch = async (payload: MatchStartRequest): Promise<MatchStartResponse> =>
  jsonRequest<MatchStartResponse>(withBaseUrl('/api/match/start'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const fetchMatch = async (matchId: string): Promise<MatchSnapshot> =>
  jsonRequest<MatchSnapshot>(withBaseUrl(`/api/match/${encodeURIComponent(matchId)}`));

export const submitMatchResult = async (payload: MatchSubmitRequest): Promise<MatchSubmitResponse> =>
  jsonRequest<MatchSubmitResponse>(withBaseUrl('/api/match/submit'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });

import { getPlayerById, getSupabase, setCors } from './leaderboard.js';

export type MatchStatus = 'waiting' | 'ready' | 'started' | 'finished';

export type Submission = {
  playerId: string;
  scoreStars: number;
  correctCount: number;
  totalCount: number;
  timeMs: number;
  submittedAt: string;
};

export type MatchRecord = {
  matchId: string;
  joinToken: string;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
  host: { playerId: string; ratingLocked: number };
  guest: { playerId: string; ratingLocked: number } | null;
  avgRatingLocked: number | null;
  seedLocked: number;
  challengeConfig: { gameMode: 'galaxy_mix'; flowTarget: number; puzzleTarget: number } | null;
  startAt: number | null;
  submissions: Record<string, Submission>;
  results: {
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
  } | null;
};

const SOLO_CHALLENGE_CONFIG = { gameMode: 'galaxy_mix' as const, flowTarget: 8, puzzleTarget: 3 };
const MATCH_COUNTDOWN_MS = 5000;

const globalScope = globalThis as typeof globalThis & {
  __GG_MATCH_STORE__?: Map<string, MatchRecord>;
};

const getStore = () => {
  if (!globalScope.__GG_MATCH_STORE__) {
    globalScope.__GG_MATCH_STORE__ = new Map<string, MatchRecord>();
  }
  return globalScope.__GG_MATCH_STORE__;
};

const clampRating = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 900;
  return Math.max(800, Math.min(1700, Math.round(numeric)));
};

const createMatchId = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const createJoinToken = () => Math.random().toString(36).slice(2, 14);
const createSeed = () => Math.floor(Math.random() * 2_147_483_000) + 1;

const summarizeSubmissions = (match: MatchRecord) => {
  if (!match.host?.playerId || !match.guest?.playerId) return null;
  const hostSubmission = match.submissions[match.host.playerId];
  const guestSubmission = match.submissions[match.guest.playerId];
  if (!hostSubmission || !guestSubmission) return null;

  const withTieBreakers = [hostSubmission, guestSubmission].map((submission) => {
    const totalCount = Math.max(0, Number(submission.totalCount) || 0);
    const correctCount = Math.max(0, Number(submission.correctCount) || 0);
    const safeTime = Math.max(0, Number(submission.timeMs) || 0);
    const accuracy = totalCount > 0 ? correctCount / totalCount : 0;
    return {
      ...submission,
      totalCount,
      correctCount,
      timeMs: safeTime,
      accuracy
    };
  });

  withTieBreakers.sort((a, b) => {
    if (b.scoreStars !== a.scoreStars) return b.scoreStars - a.scoreStars;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.timeMs - b.timeMs;
  });

  const winner = withTieBreakers[0];
  return {
    winnerPlayerId: winner.playerId,
    players: withTieBreakers.map((entry) => ({
      playerId: entry.playerId,
      scoreStars: entry.scoreStars,
      correctCount: entry.correctCount,
      totalCount: entry.totalCount,
      timeMs: entry.timeMs,
      accuracy: Number(entry.accuracy.toFixed(4)),
      submittedAt: entry.submittedAt
    })),
    tiebreakUsed:
      withTieBreakers[0].scoreStars === withTieBreakers[1].scoreStars
        ? withTieBreakers[0].accuracy === withTieBreakers[1].accuracy
          ? 'time'
          : 'accuracy'
        : 'score'
  };
};

const getLockedPlayerRating = async (playerId: string) => {
  try {
    const supabase = await getSupabase();
    const player = await getPlayerById(supabase, playerId);
    return clampRating(player?.all_time_stars ?? player?.best_run_stars ?? 900);
  } catch {
    return 900;
  }
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

export const handleMatchCreate = async (req: any, res: any) => {
  const body = parseBody(req);
  const hostPlayerId = typeof body?.hostPlayerId === 'string' ? body.hostPlayerId.trim() : '';
  if (!hostPlayerId) return res.status(400).json({ error: 'hostPlayerId is required' });

  const hostRating = await getLockedPlayerRating(hostPlayerId);
  const matchId = createMatchId();
  const joinToken = createJoinToken();
  const seedLocked = createSeed();
  const now = new Date().toISOString();
  const store = getStore();

  const originHeader = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  const hostHeader = typeof req.headers?.host === 'string' ? req.headers.host : '';
  const protocol = typeof req.headers?.['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'] : 'https';
  const base = originHeader || (hostHeader ? `${protocol}://${hostHeader}` : '');
  const joinUrl = base ? `${base.replace(/\/+$/, '')}/match/${matchId}?token=${joinToken}` : `/match/${matchId}?token=${joinToken}`;

  store.set(matchId, {
    matchId,
    joinToken,
    status: 'waiting',
    createdAt: now,
    updatedAt: now,
    host: { playerId: hostPlayerId, ratingLocked: hostRating },
    guest: null,
    avgRatingLocked: null,
    seedLocked,
    challengeConfig: null,
    startAt: null,
    submissions: {},
    results: null
  });

  return res.status(200).json({ matchId, joinUrl });
};

export const handleMatchJoin = async (req: any, res: any) => {
  const body = parseBody(req);
  const matchId = typeof body?.matchId === 'string' ? body.matchId.trim() : '';
  const joinToken = typeof body?.joinToken === 'string' ? body.joinToken.trim() : '';
  const guestPlayerId = typeof body?.guestPlayerId === 'string' ? body.guestPlayerId.trim() : '';
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });
  if (!joinToken) return res.status(400).json({ error: 'joinToken is required' });
  if (!guestPlayerId) return res.status(400).json({ error: 'guestPlayerId is required' });

  const store = getStore();
  const match = store.get(matchId);
  if (!match) return res.status(404).json({ error: 'match not found' });
  if (match.joinToken !== joinToken) return res.status(403).json({ error: 'invalid join token' });
  if (match.host.playerId === guestPlayerId) return res.status(400).json({ error: 'guest must be different from host' });
  if (match.status === 'finished') return res.status(409).json({ error: 'match already finished' });

  const guestRating = await getLockedPlayerRating(guestPlayerId);
  const hostRating = clampRating(match.host.ratingLocked);
  match.guest = { playerId: guestPlayerId, ratingLocked: guestRating };
  match.avgRatingLocked = Math.round((hostRating + guestRating) / 2);
  match.status = 'ready';
  match.updatedAt = new Date().toISOString();

  return res.status(200).json({ status: 'ready' });
};

export const handleMatchStart = async (req: any, res: any) => {
  const body = parseBody(req);
  const matchId = typeof body?.matchId === 'string' ? body.matchId.trim() : '';
  const hostPlayerId = typeof body?.hostPlayerId === 'string' ? body.hostPlayerId.trim() : '';
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });
  if (!hostPlayerId) return res.status(400).json({ error: 'hostPlayerId is required' });

  const store = getStore();
  const match = store.get(matchId);
  if (!match) return res.status(404).json({ error: 'match not found' });
  if (match.host.playerId !== hostPlayerId) return res.status(403).json({ error: 'only host can start the match' });
  if (!match.guest?.playerId) return res.status(409).json({ error: 'match not ready' });

  if (match.status !== 'started' && match.status !== 'finished') {
    match.startAt = Date.now() + MATCH_COUNTDOWN_MS;
    match.challengeConfig = { ...SOLO_CHALLENGE_CONFIG };
    match.avgRatingLocked = clampRating(match.avgRatingLocked ?? match.host.ratingLocked);
    match.status = 'started';
    match.updatedAt = new Date().toISOString();
  }

  return res.status(200).json({
    startAt: match.startAt,
    avgRatingLocked: match.avgRatingLocked,
    seedLocked: match.seedLocked,
    challengeConfig: match.challengeConfig
  });
};

export const handleMatchGet = async (req: any, res: any) => {
  const matchId = typeof req.query?.matchId === 'string' ? req.query.matchId : req.query?.matchId?.[0];
  if (!matchId || typeof matchId !== 'string') return res.status(400).json({ error: 'matchId is required' });

  const match = getStore().get(matchId);
  if (!match) return res.status(404).json({ error: 'match not found' });

  return res.status(200).json({
    matchId: match.matchId,
    status: match.status,
    hostPlayerId: match.host?.playerId ?? null,
    guestPlayerId: match.guest?.playerId ?? null,
    startAt: match.startAt,
    avgRatingLocked: match.avgRatingLocked,
    seedLocked: match.status === 'started' || match.status === 'finished' ? match.seedLocked : null,
    challengeConfig: match.status === 'started' || match.status === 'finished' ? match.challengeConfig : null,
    results: match.status === 'finished' ? match.results : null
  });
};

export const handleMatchSubmit = async (req: any, res: any) => {
  const body = parseBody(req);
  const matchId = typeof body?.matchId === 'string' ? body.matchId.trim() : '';
  const playerId = typeof body?.playerId === 'string' ? body.playerId.trim() : '';
  if (!matchId) return res.status(400).json({ error: 'matchId is required' });
  if (!playerId) return res.status(400).json({ error: 'playerId is required' });

  const scoreStars = Math.max(0, Math.floor(Number(body?.scoreStars) || 0));
  const correctCount = Math.max(0, Math.floor(Number(body?.correctCount) || 0));
  const totalCount = Math.max(0, Math.floor(Number(body?.totalCount) || 0));
  const timeMs = Math.max(0, Math.floor(Number(body?.timeMs) || 0));

  const store = getStore();
  const match = store.get(matchId);
  if (!match) return res.status(404).json({ error: 'match not found' });
  if (match.status !== 'started' && match.status !== 'finished') {
    return res.status(409).json({ error: 'match has not started' });
  }

  const isParticipant = match.host?.playerId === playerId || match.guest?.playerId === playerId;
  if (!isParticipant) return res.status(403).json({ error: 'player not in this match' });

  match.submissions[playerId] = {
    playerId,
    scoreStars,
    correctCount,
    totalCount,
    timeMs,
    submittedAt: new Date().toISOString()
  };
  const summary = summarizeSubmissions(match);
  if (summary) {
    match.results = summary;
    match.status = 'finished';
  }
  match.updatedAt = new Date().toISOString();

  return res.status(200).json({
    status: match.status,
    resultsIfFinished: match.status === 'finished' ? match.results : null
  });
};

export const withMatchCors = (res: any) => setCors(res);

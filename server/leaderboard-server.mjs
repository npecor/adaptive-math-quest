import express from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, 'leaderboard-data.json');
const PORT = Number(process.env.LEADERBOARD_PORT || 8787);
const CORS_ORIGIN = process.env.LEADERBOARD_CORS_ORIGIN || '*';

const DEFAULT_BOTS = [
  { username: 'Astro', avatarId: 'astro-comet', allTimeStars: 14200, bestRunStars: 1860, trophiesEarned: 38, extensionsSolved: 24 },
  { username: 'Nova', avatarId: 'astro-starlight', allTimeStars: 13780, bestRunStars: 1720, trophiesEarned: 35, extensionsSolved: 21 },
  { username: 'Cyber', avatarId: 'astro-cadet', allTimeStars: 13040, bestRunStars: 1640, trophiesEarned: 32, extensionsSolved: 18 },
  { username: 'Comet_X', avatarId: 'animal-space-fox', allTimeStars: 11900, bestRunStars: 1490, trophiesEarned: 29, extensionsSolved: 15 },
  { username: 'Sputnik', avatarId: 'animal-panda-jet', allTimeStars: 10800, bestRunStars: 1380, trophiesEarned: 25, extensionsSolved: 12 }
];

const defaultState = {
  players: {}
};

const normalizeUsernameKey = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const cleanUsername = (value) => value.trim().replace(/\s+/g, ' ');

const ensureState = (rawState) => {
  const state = rawState && typeof rawState === 'object' ? rawState : { ...defaultState };
  if (!state.players || typeof state.players !== 'object') state.players = {};

  for (const [userId, rawPlayer] of Object.entries(state.players)) {
    if (!rawPlayer || typeof rawPlayer !== 'object') continue;
    const player = rawPlayer;
    const scoreFallback = Number.isFinite(player.highScore) ? Math.max(0, Math.floor(player.highScore)) : 0;
    player.userId = player.userId ?? userId;
    player.username = typeof player.username === 'string' ? cleanUsername(player.username) : 'Player';
    player.usernameKey = player.usernameKey ?? normalizeUsernameKey(player.username);
    player.avatarId = typeof player.avatarId === 'string' ? player.avatarId.trim() : 'astro-bot';
    player.allTimeStars = Number.isFinite(player.allTimeStars) ? Math.max(0, Math.floor(player.allTimeStars)) : scoreFallback;
    player.bestRunStars = Number.isFinite(player.bestRunStars) ? Math.max(0, Math.floor(player.bestRunStars)) : scoreFallback;
    player.trophiesEarned = Number.isFinite(player.trophiesEarned) ? Math.max(0, Math.floor(player.trophiesEarned)) : 0;
    player.extensionsSolved = Number.isFinite(player.extensionsSolved) ? Math.max(0, Math.floor(player.extensionsSolved)) : 0;
    player.highScore = player.allTimeStars;
  }

  const now = new Date().toISOString();
  if (Object.keys(state.players).length === 0) {
    for (const bot of DEFAULT_BOTS) {
      const userId = `bot-${normalizeUsernameKey(bot.username).replace(/[^a-z0-9]+/g, '-')}`;
      state.players[userId] = {
        userId,
        username: bot.username,
        usernameKey: normalizeUsernameKey(bot.username),
        avatarId: bot.avatarId,
        allTimeStars: bot.allTimeStars,
        bestRunStars: bot.bestRunStars,
        trophiesEarned: bot.trophiesEarned,
        extensionsSolved: bot.extensionsSolved,
        highScore: bot.allTimeStars,
        createdAt: now,
        updatedAt: now,
        isBot: true
      };
    }
  }

  return state;
};

const readState = async () => {
  try {
    const raw = await readFile(DATA_PATH, 'utf8');
    return ensureState(JSON.parse(raw));
  } catch {
    const state = ensureState({ ...defaultState });
    await writeState(state);
    return state;
  }
};

const writeState = async (state) => {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  const next = JSON.stringify(state, null, 2);
  await writeFile(DATA_PATH, next, 'utf8');
};

const buildUsernameIndex = (players) => {
  const index = new Map();
  for (const player of Object.values(players)) {
    if (player?.usernameKey) index.set(player.usernameKey, player.userId);
  }
  return index;
};

const dedupeUsername = (requestedUsername, players, userId) => {
  const baseName = cleanUsername(requestedUsername);
  const baseKey = normalizeUsernameKey(baseName);
  const usernameIndex = buildUsernameIndex(players);

  if (!usernameIndex.has(baseKey) || usernameIndex.get(baseKey) === userId) {
    return { username: baseName, usernameKey: baseKey, deduped: false };
  }

  let counter = 2;
  while (counter < 10000) {
    const candidate = `${baseName} ${counter}`;
    const candidateKey = normalizeUsernameKey(candidate);
    if (!usernameIndex.has(candidateKey) || usernameIndex.get(candidateKey) === userId) {
      return { username: candidate, usernameKey: candidateKey, deduped: true };
    }
    counter += 1;
  }

  const fallback = `${baseName}-${Date.now()}`;
  return { username: fallback, usernameKey: normalizeUsernameKey(fallback), deduped: true };
};

const toLeaderboardRows = (players, mode = 'all_time', limit = 50) =>
  Object.values(players)
    .filter((player) => Number.isFinite(player.allTimeStars) || Number.isFinite(player.highScore))
    .sort((a, b) => {
      if (mode === 'best_run') {
        if (b.bestRunStars !== a.bestRunStars) return b.bestRunStars - a.bestRunStars;
        if (b.allTimeStars !== a.allTimeStars) return b.allTimeStars - a.allTimeStars;
        return a.updatedAt.localeCompare(b.updatedAt);
      }
      if (mode === 'trophies') {
        if (b.trophiesEarned !== a.trophiesEarned) return b.trophiesEarned - a.trophiesEarned;
        if (b.extensionsSolved !== a.extensionsSolved) return b.extensionsSolved - a.extensionsSolved;
        if (b.allTimeStars !== a.allTimeStars) return b.allTimeStars - a.allTimeStars;
        return a.updatedAt.localeCompare(b.updatedAt);
      }
      if (b.allTimeStars !== a.allTimeStars) return b.allTimeStars - a.allTimeStars;
      if (b.bestRunStars !== a.bestRunStars) return b.bestRunStars - a.bestRunStars;
      return a.updatedAt.localeCompare(b.updatedAt);
    })
    .slice(0, limit)
    .map((player, index) => ({
      rank: index + 1,
      userId: player.userId,
      username: player.username,
      avatarId: player.avatarId,
      allTimeStars: player.allTimeStars,
      bestRunStars: player.bestRunStars,
      trophiesEarned: player.trophiesEarned,
      extensionsSolved: player.extensionsSolved,
      updatedAt: player.updatedAt,
      isBot: Boolean(player.isBot)
    }));

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/players/register', async (req, res) => {
  const { username, avatarId, userId } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (typeof avatarId !== 'string' || !avatarId.trim()) {
    return res.status(400).json({ error: 'avatarId is required' });
  }

  const state = await readState();
  const now = new Date().toISOString();
  const existing = typeof userId === 'string' ? state.players[userId] : undefined;
  const resolvedUserId = existing?.userId ?? randomUUID();
  const { username: resolvedUsername, usernameKey, deduped } = dedupeUsername(username, state.players, resolvedUserId);

  state.players[resolvedUserId] = {
    userId: resolvedUserId,
    username: resolvedUsername,
    usernameKey,
    avatarId: avatarId.trim(),
    allTimeStars: existing?.allTimeStars ?? existing?.highScore ?? 0,
    bestRunStars: existing?.bestRunStars ?? existing?.highScore ?? 0,
    trophiesEarned: existing?.trophiesEarned ?? 0,
    extensionsSolved: existing?.extensionsSolved ?? 0,
    highScore: existing?.allTimeStars ?? existing?.highScore ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    isBot: false
  };

  await writeState(state);

  return res.json({
    userId: resolvedUserId,
    username: resolvedUsername,
    avatarId: avatarId.trim(),
    createdAt: state.players[resolvedUserId].createdAt,
    updatedAt: now,
    deduped
  });
});

app.post('/api/scores/upsert', async (req, res) => {
  const {
    userId,
    username,
    avatarId,
    score,
    allTimeStars,
    bestRunStars,
    trophiesEarned,
    extensionsSolved
  } = req.body ?? {};
  if (typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (typeof avatarId !== 'string' || !avatarId.trim()) {
    return res.status(400).json({ error: 'avatarId is required' });
  }
  const numericScore = Number(score);
  const hasLegacyScore = Number.isFinite(numericScore) && numericScore >= 0;

  const numericAllTimeStars = Number(allTimeStars);
  const numericBestRunStars = Number(bestRunStars);
  const numericTrophiesEarned = Number(trophiesEarned);
  const numericExtensionsSolved = Number(extensionsSolved);
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

  const state = await readState();
  const now = new Date().toISOString();
  const existing = state.players[userId];
  const { username: resolvedUsername, usernameKey } = dedupeUsername(username, state.players, userId);

  const incomingAllTime = hasNewPayload ? Math.floor(numericAllTimeStars) : Math.floor(numericScore);
  const incomingBestRun = hasNewPayload ? Math.floor(numericBestRunStars) : Math.floor(numericScore);
  const incomingTrophies = hasNewPayload ? Math.floor(numericTrophiesEarned) : 0;
  const incomingExtensions = hasNewPayload ? Math.floor(numericExtensionsSolved) : 0;

  const resolvedAllTimeStars = Math.max(existing?.allTimeStars ?? existing?.highScore ?? 0, incomingAllTime);
  const resolvedBestRunStars = Math.max(existing?.bestRunStars ?? existing?.highScore ?? 0, incomingBestRun);
  const resolvedTrophiesEarned = Math.max(existing?.trophiesEarned ?? 0, incomingTrophies);
  const resolvedExtensionsSolved = Math.max(existing?.extensionsSolved ?? 0, incomingExtensions);

  state.players[userId] = {
    userId,
    username: resolvedUsername,
    usernameKey,
    avatarId: avatarId.trim(),
    allTimeStars: resolvedAllTimeStars,
    bestRunStars: resolvedBestRunStars,
    trophiesEarned: resolvedTrophiesEarned,
    extensionsSolved: resolvedExtensionsSolved,
    highScore: resolvedAllTimeStars,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    isBot: false
  };

  await writeState(state);

  return res.json({
    ok: true,
    userId,
    username: resolvedUsername,
    allTimeStars: state.players[userId].allTimeStars,
    bestRunStars: state.players[userId].bestRunStars,
    trophiesEarned: state.players[userId].trophiesEarned,
    extensionsSolved: state.players[userId].extensionsSolved
  });
});

app.get('/api/leaderboard', async (req, res) => {
  const state = await readState();
  const modeRaw = typeof req.query.mode === 'string' ? req.query.mode : 'all_time';
  const mode = ['all_time', 'best_run', 'trophies'].includes(modeRaw) ? modeRaw : 'all_time';
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  return res.json({ rows: toLeaderboardRows(state.players, mode, limit) });
});

app.listen(PORT, () => {
  console.log(`Leaderboard API listening on http://localhost:${PORT}`);
});

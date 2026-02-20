import express from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, 'leaderboard-data.json');
const PORT = Number(process.env.LEADERBOARD_PORT || 8787);

const DEFAULT_BOTS = [
  { username: 'Astro', avatarId: 'astro-comet', highScore: 14200 },
  { username: 'Nova', avatarId: 'astro-starlight', highScore: 13780 },
  { username: 'Cyber', avatarId: 'astro-cadet', highScore: 13040 },
  { username: 'Comet_X', avatarId: 'animal-space-fox', highScore: 11900 },
  { username: 'Sputnik', avatarId: 'animal-panda-jet', highScore: 10800 }
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

  const now = new Date().toISOString();
  if (Object.keys(state.players).length === 0) {
    for (const bot of DEFAULT_BOTS) {
      const userId = `bot-${normalizeUsernameKey(bot.username).replace(/[^a-z0-9]+/g, '-')}`;
      state.players[userId] = {
        userId,
        username: bot.username,
        usernameKey: normalizeUsernameKey(bot.username),
        avatarId: bot.avatarId,
        highScore: bot.highScore,
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

const toLeaderboardRows = (players, limit = 50) =>
  Object.values(players)
    .filter((player) => typeof player.highScore === 'number')
    .sort((a, b) => {
      if (b.highScore !== a.highScore) return b.highScore - a.highScore;
      return a.updatedAt.localeCompare(b.updatedAt);
    })
    .slice(0, limit)
    .map((player, index) => ({
      rank: index + 1,
      userId: player.userId,
      username: player.username,
      avatarId: player.avatarId,
      score: player.highScore,
      updatedAt: player.updatedAt,
      isBot: Boolean(player.isBot)
    }));

const app = express();
app.use(express.json());

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
    highScore: existing?.highScore ?? 0,
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
  const { userId, username, avatarId, score } = req.body ?? {};
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
  if (!Number.isFinite(numericScore) || numericScore < 0) {
    return res.status(400).json({ error: 'score must be a non-negative number' });
  }

  const state = await readState();
  const now = new Date().toISOString();
  const existing = state.players[userId];
  const { username: resolvedUsername, usernameKey } = dedupeUsername(username, state.players, userId);

  state.players[userId] = {
    userId,
    username: resolvedUsername,
    usernameKey,
    avatarId: avatarId.trim(),
    highScore: Math.max(existing?.highScore ?? 0, Math.floor(numericScore)),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    isBot: false
  };

  await writeState(state);

  return res.json({
    ok: true,
    userId,
    username: resolvedUsername,
    score: state.players[userId].highScore
  });
});

app.get('/api/leaderboard', async (req, res) => {
  const state = await readState();
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  return res.json({ rows: toLeaderboardRows(state.players, limit) });
});

app.listen(PORT, () => {
  console.log(`Leaderboard API listening on http://localhost:${PORT}`);
});

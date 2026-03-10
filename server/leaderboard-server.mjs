import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_PATH = path.join(__dirname, 'weekend-world-hunt-data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PORT = Number(process.env.LEADERBOARD_PORT || 8787);
const CORS_ORIGIN = process.env.LEADERBOARD_CORS_ORIGIN || '*';

const REACTION_TYPES = ['fire', 'lol', 'wow', 'brain'];
const AWARD_KEYS = ['BEST_EYE', 'FUNNIEST', 'CURSED', 'CINEMATIC', 'NPC_ENERGY'];

const SEED_PROMPTS = [
  { code: 'A-01', title: 'Something that should not exist', description: 'Capture a reality glitch in the wild.', mediaHint: 'clip_encouraged' },
  { code: 'A-02', title: 'Cursed object', description: 'Find an object with deeply questionable vibes.', mediaHint: 'photo_ok' },
  { code: 'A-03', title: 'Blessed object', description: 'Find an object that restores faith in humanity.', mediaHint: 'photo_ok' },
  { code: 'A-04', title: 'Corporate apology', description: 'Deliver a dramatic apology to absolutely nobody.', mediaHint: 'clip_encouraged' },
  { code: 'A-05', title: 'NPC side quest moment', description: 'Document a random side quest encounter.', mediaHint: 'photo_ok' },
  { code: 'A-06', title: 'Unhinged product commercial', description: 'Pitch a ridiculous product like it is prime-time TV.', mediaHint: 'clip_encouraged' },
  { code: 'A-07', title: 'Found in the wild', description: 'Catch something oddly perfect in its natural habitat.', mediaHint: 'photo_ok' },
  { code: 'A-08', title: 'How it started / how it\'s going', description: 'Show contrast in one frame or sequence.', mediaHint: 'photo_ok' },
  { code: 'A-09', title: 'Album cover drop', description: 'Compose a frame that feels like an instant album cover.', mediaHint: 'photo_ok' },
  { code: 'A-10', title: 'True crime evidence photo', description: 'Stage a suspicious clue board snapshot.', mediaHint: 'photo_ok' },
  { code: 'A-11', title: 'Main character entrance', description: 'Record a dramatic entrance sequence.', mediaHint: 'clip_encouraged' },
  { code: 'A-12', title: 'The tiniest shrine', description: 'Find or build a micro-monument in the field.', mediaHint: 'photo_ok' }
];

const defaultState = {
  hunts: [],
  prompts: [],
  participants: [],
  submissions: [],
  reactions: [],
  nominations: []
};

const nowIso = () => new Date().toISOString();

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const cleanCallsign = (value) => cleanString(value).replace(/\s+/g, '_').slice(0, 24);

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const generateInviteCode = (state) => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const pickLetter = () => letters[Math.floor(Math.random() * letters.length)];
  const pickDigits = () => String(Math.floor(Math.random() * 900) + 100);
  let inviteCode = '';
  do {
    inviteCode = `${pickLetter()}${pickLetter()}-${pickDigits()}-${pickLetter()}`;
  } while (state.hunts.some((hunt) => hunt.inviteCode === inviteCode));
  return inviteCode;
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const ensureState = (rawState) => ({
  hunts: ensureArray(rawState?.hunts),
  prompts: ensureArray(rawState?.prompts),
  participants: ensureArray(rawState?.participants),
  submissions: ensureArray(rawState?.submissions),
  reactions: ensureArray(rawState?.reactions),
  nominations: ensureArray(rawState?.nominations)
});

const readState = async () => {
  try {
    const raw = await readFile(DATA_PATH, 'utf8');
    return ensureState(JSON.parse(raw));
  } catch {
    await writeState(defaultState);
    return ensureState(defaultState);
  }
};

const writeState = async (state) => {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(state, null, 2), 'utf8');
};

const getHunt = (state, huntId) => state.hunts.find((hunt) => hunt.id === huntId);

const getSubmission = (state, submissionId) => state.submissions.find((submission) => submission.id === submissionId);

const serializeParticipant = (participant) => ({
  id: participant.id,
  huntId: participant.huntId,
  callsign: participant.callsign,
  role: participant.role,
  avatarUrl: participant.avatarUrl,
  joinedAt: participant.joinedAt
});

const serializeHunt = (hunt, state) => ({
  ...hunt,
  participantCount: state.participants.filter((participant) => participant.huntId === hunt.id).length
});

const resolveParticipantForHunt = (state, huntId, token) => {
  if (!token) return null;
  const tokenHash = hashToken(token);
  return state.participants.find(
    (participant) => participant.huntId === huntId && participant.sessionTokenHash === tokenHash
  );
};

const getTokenFromReq = (req) => {
  const headerToken = cleanString(req.header('X-Session-Token'));
  if (headerToken) return headerToken;
  return cleanString(req.body?.deviceSessionToken);
};

const requireParticipant = (req, res, state, huntId) => {
  const token = getTokenFromReq(req);
  const participant = resolveParticipantForHunt(state, huntId, token);
  if (!participant) {
    res.status(401).json({ error: 'session participant not found for hunt' });
    return null;
  }
  return participant;
};

const requireHost = (req, res, state, huntId) => {
  const participant = requireParticipant(req, res, state, huntId);
  if (!participant) return null;
  if (participant.role !== 'host') {
    res.status(403).json({ error: 'host role required' });
    return null;
  }
  return participant;
};

const reactionCountMapForHunt = (state, huntId) => {
  const map = new Map();
  for (const submission of state.submissions) {
    if (submission.huntId !== huntId || submission.status !== 'active') continue;
    map.set(submission.id, { fire: 0, lol: 0, wow: 0, brain: 0 });
  }
  for (const reaction of state.reactions) {
    const counts = map.get(reaction.submissionId);
    if (!counts || !REACTION_TYPES.includes(reaction.type)) continue;
    counts[reaction.type] += 1;
  }
  return map;
};

const nominationCountMapForHunt = (state, huntId) => {
  const map = new Map();
  for (const submission of state.submissions) {
    if (submission.huntId !== huntId || submission.status !== 'active') continue;
    map.set(submission.id, 0);
  }
  for (const nomination of state.nominations) {
    if (!map.has(nomination.submissionId)) continue;
    map.set(nomination.submissionId, (map.get(nomination.submissionId) || 0) + 1);
  }
  return map;
};

const sortByCreatedAtDesc = (a, b) => b.createdAt.localeCompare(a.createdAt);

const sortFeedSubmissions = (submissions) => {
  submissions.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isPinned && b.isPinned) {
      const aPinnedAt = a.pinnedAt || '';
      const bPinnedAt = b.pinnedAt || '';
      if (aPinnedAt !== bPinnedAt) return bPinnedAt.localeCompare(aPinnedAt);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
  return submissions;
};

const serializeSubmission = (submission, state, viewerParticipantId, countsBySubmission, nominationsBySubmission) => {
  const prompt = state.prompts.find((candidate) => candidate.id === submission.promptId) || null;
  const participant = state.participants.find((candidate) => candidate.id === submission.participantId) || null;
  const reactionCounts = countsBySubmission.get(submission.id) || { fire: 0, lol: 0, wow: 0, brain: 0 };
  const nominationCount = nominationsBySubmission.get(submission.id) || 0;
  const myReactions = viewerParticipantId
    ? state.reactions
        .filter(
          (reaction) =>
            reaction.submissionId === submission.id && reaction.participantId === viewerParticipantId
        )
        .map((reaction) => reaction.type)
    : [];
  const nominatedByMe = viewerParticipantId
    ? state.nominations.some(
        (nomination) =>
          nomination.submissionId === submission.id && nomination.participantId === viewerParticipantId
      )
    : false;

  return {
    ...submission,
    prompt,
    participant: participant ? serializeParticipant(participant) : null,
    reactionCounts,
    nominationCount,
    myReactions,
    nominatedByMe
  };
};

const autoEndExpiredHunts = (state) => {
  const now = Date.now();
  let changed = false;
  for (const hunt of state.hunts) {
    if (hunt.status !== 'live' || !hunt.endsAt) continue;
    if (Date.parse(hunt.endsAt) <= now) {
      hunt.status = 'ended';
      changed = true;
    }
  }
  return changed;
};

const buildRecapPayload = (state, huntId) => {
  const countsBySubmission = reactionCountMapForHunt(state, huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, huntId);
  const allActive = state.submissions.filter(
    (submission) => submission.huntId === huntId && submission.status === 'active'
  );

  const pinned = sortFeedSubmissions(allActive.filter((submission) => submission.isPinned)).map((submission) =>
    serializeSubmission(submission, state, null, countsBySubmission, nominationsBySubmission)
  );

  const hostPicks = allActive
    .filter((submission) => submission.isHostPick)
    .sort(sortByCreatedAtDesc)
    .map((submission) => serializeSubmission(submission, state, null, countsBySubmission, nominationsBySubmission));

  const recapSelections = allActive
    .filter((submission) => submission.inRecap)
    .sort(sortByCreatedAtDesc)
    .map((submission) => serializeSubmission(submission, state, null, countsBySubmission, nominationsBySubmission));

  const awards = {};
  for (const key of AWARD_KEYS) {
    awards[key] = [];
  }

  for (const submission of allActive) {
    if (!submission.awardKey || !awards[submission.awardKey]) continue;
    awards[submission.awardKey].push(
      serializeSubmission(submission, state, null, countsBySubmission, nominationsBySubmission)
    );
  }

  for (const key of Object.keys(awards)) {
    awards[key].sort(sortByCreatedAtDesc);
  }

  return {
    pinned,
    hostPicks,
    recapSelections,
    awards
  };
};

const app = express();

app.use(express.json({ limit: '80mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Session-Token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'weekend-world-hunt-api', now: nowIso() });
});

app.post('/api/hunts', async (req, res) => {
  const title = cleanString(req.body?.title);
  const durationMinutes = Number(req.body?.durationMinutes);
  const callsignInput = cleanString(req.body?.callsign);
  const token = getTokenFromReq(req);

  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!Number.isFinite(durationMinutes) || durationMinutes < 30 || durationMinutes > 1440) {
    return res.status(400).json({ error: 'durationMinutes must be between 30 and 1440' });
  }
  if (!token) return res.status(400).json({ error: 'deviceSessionToken is required' });

  const state = await readState();
  const inviteCode = generateInviteCode(state);
  const now = nowIso();
  const huntId = randomUUID();
  const hostParticipantId = randomUUID();

  const hunt = {
    id: huntId,
    title,
    status: 'draft',
    createdAt: now,
    startsAt: null,
    endsAt: null,
    durationMinutes: Math.round(durationMinutes),
    createdByParticipantId: hostParticipantId,
    inviteCode,
    settings: {
      allowUploadsFromCameraRoll: true,
      allowInAppCapture: true,
      clipMaxSeconds: 7,
      allowComments: false,
      allowNominations: true
    }
  };

  const participant = {
    id: hostParticipantId,
    huntId,
    callsign: callsignInput || 'ADMIN_01',
    role: 'host',
    sessionTokenHash: hashToken(token),
    avatarUrl: null,
    joinedAt: now
  };

  const prompts = SEED_PROMPTS.map((seedPrompt) => ({
    id: randomUUID(),
    huntId,
    code: seedPrompt.code,
    title: seedPrompt.title,
    description: seedPrompt.description,
    mediaHint: seedPrompt.mediaHint
  }));

  state.hunts.push(hunt);
  state.participants.push(participant);
  state.prompts.push(...prompts);
  await writeState(state);

  res.status(201).json({
    hunt: serializeHunt(hunt, state),
    participant: serializeParticipant(participant),
    prompts,
    joinPath: `/join/${inviteCode}`
  });
});

app.get('/api/hunts/by-invite/:inviteCode', async (req, res) => {
  const inviteCode = cleanString(req.params.inviteCode).toUpperCase();
  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  const hunt = state.hunts.find((candidate) => candidate.inviteCode === inviteCode);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });
  if (changed) await writeState(state);

  res.json({ hunt: serializeHunt(hunt, state) });
});

app.get('/api/hunts/:huntId', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });
  if (changed) await writeState(state);

  const me = resolveParticipantForHunt(state, huntId, getTokenFromReq(req));
  const participants = state.participants
    .filter((participant) => participant.huntId === huntId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map(serializeParticipant);

  res.json({
    hunt: serializeHunt(hunt, state),
    me: me ? serializeParticipant(me) : null,
    participants
  });
});

app.get('/api/hunts/:huntId/participants', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  const participants = state.participants
    .filter((participant) => participant.huntId === huntId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map(serializeParticipant);

  res.json({ participants });
});

app.post('/api/hunts/:huntId/join', async (req, res) => {
  const { huntId } = req.params;
  const callsignRaw = cleanCallsign(req.body?.callsign);
  const token = cleanString(req.body?.deviceSessionToken);
  const avatarUrl = cleanString(req.body?.avatarUrl) || null;

  if (!callsignRaw) return res.status(400).json({ error: 'callsign is required' });
  if (!token) return res.status(400).json({ error: 'deviceSessionToken is required' });

  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  if (changed) await writeState(state);
  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  const tokenHash = hashToken(token);
  const existing = state.participants.find(
    (participant) => participant.huntId === huntId && participant.sessionTokenHash === tokenHash
  );
  if (existing) {
    return res.json({ participant: serializeParticipant(existing), role: existing.role });
  }

  const normalizedCallsign = callsignRaw.toUpperCase();
  const siblingCallsigns = new Set(
    state.participants
      .filter((participant) => participant.huntId === huntId)
      .map((participant) => participant.callsign.toUpperCase())
  );

  let callsign = normalizedCallsign;
  let suffix = 2;
  while (siblingCallsigns.has(callsign)) {
    callsign = `${normalizedCallsign}_${suffix}`;
    suffix += 1;
  }

  const participant = {
    id: randomUUID(),
    huntId,
    callsign,
    role: 'player',
    sessionTokenHash: tokenHash,
    avatarUrl,
    joinedAt: nowIso()
  };

  state.participants.push(participant);
  await writeState(state);
  res.status(201).json({ participant: serializeParticipant(participant), role: 'player' });
});

app.get('/api/hunts/:huntId/me', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const participant = resolveParticipantForHunt(state, huntId, getTokenFromReq(req));
  if (!participant) return res.status(404).json({ error: 'participant not found for token' });
  res.json({ participant: serializeParticipant(participant), role: participant.role });
});

app.post('/api/hunts/:huntId/start', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });
  const host = requireHost(req, res, state, huntId);
  if (!host) return;

  if (hunt.status === 'ended') return res.status(400).json({ error: 'hunt has already ended' });

  const now = new Date();
  const startsAt = hunt.startsAt || now.toISOString();
  const endsAt = new Date(now.getTime() + hunt.durationMinutes * 60 * 1000).toISOString();

  hunt.status = 'live';
  hunt.startsAt = startsAt;
  hunt.endsAt = endsAt;

  await writeState(state);
  res.json({ hunt: serializeHunt(hunt, state) });
});

app.post('/api/hunts/:huntId/end', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });
  const host = requireHost(req, res, state, huntId);
  if (!host) return;

  hunt.status = 'ended';
  hunt.endsAt = nowIso();

  await writeState(state);
  res.json({ hunt: serializeHunt(hunt, state) });
});

app.get('/api/hunts/:huntId/prompts', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  const prompts = state.prompts
    .filter((prompt) => prompt.huntId === huntId)
    .sort((a, b) => a.code.localeCompare(b.code));

  res.json({ prompts });
});

app.post('/api/upload', async (req, res) => {
  const dataUrl = cleanString(req.body?.dataUrl);
  const mediaType = cleanString(req.body?.mediaType);
  const thumbnailDataUrl = cleanString(req.body?.thumbnailDataUrl);

  if (!dataUrl) return res.status(400).json({ error: 'dataUrl is required' });
  if (mediaType !== 'photo' && mediaType !== 'clip') {
    return res.status(400).json({ error: 'mediaType must be photo or clip' });
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'dataUrl must be base64 data URI' });

  const mime = match[1].toLowerCase();
  const base64 = match[2];
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  if (!isImage && !isVideo) return res.status(400).json({ error: 'unsupported mime type' });
  if (mediaType === 'photo' && !isImage) return res.status(400).json({ error: 'photo uploads must be image/*' });
  if (mediaType === 'clip' && !isVideo) return res.status(400).json({ error: 'clip uploads must be video/*' });

  const buffer = Buffer.from(base64, 'base64');
  const maxBytes = mediaType === 'photo' ? 12 * 1024 * 1024 : 40 * 1024 * 1024;
  if (buffer.byteLength > maxBytes) return res.status(413).json({ error: 'media file too large for MVP limits' });

  const extensionByMime = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov'
  };
  const extension = extensionByMime[mime] || (isImage ? 'jpg' : 'mp4');

  await mkdir(UPLOAD_DIR, { recursive: true });
  const mediaFileName = `${randomUUID()}.${extension}`;
  await writeFile(path.join(UPLOAD_DIR, mediaFileName), buffer);

  let thumbnailUrl = null;
  if (thumbnailDataUrl) {
    const thumbMatch = thumbnailDataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    if (thumbMatch) {
      const thumbExt = thumbMatch[1].toLowerCase() === 'jpeg' ? 'jpg' : thumbMatch[1].toLowerCase();
      const thumbName = `${randomUUID()}-thumb.${thumbExt}`;
      const thumbBuffer = Buffer.from(thumbMatch[2], 'base64');
      await writeFile(path.join(UPLOAD_DIR, thumbName), thumbBuffer);
      thumbnailUrl = `/uploads/${thumbName}`;
    }
  }

  res.status(201).json({ mediaUrl: `/uploads/${mediaFileName}`, thumbnailUrl });
});

app.post('/api/submissions', async (req, res) => {
  const huntId = cleanString(req.body?.huntId);
  const promptId = cleanString(req.body?.promptId);
  const mediaType = cleanString(req.body?.mediaType);
  const mediaUrl = cleanString(req.body?.mediaUrl);
  const thumbnailUrl = cleanString(req.body?.thumbnailUrl) || null;
  const caption = cleanString(req.body?.caption) || null;
  const clipDurationSeconds = Number(req.body?.clipDurationSeconds);

  if (!huntId || !promptId || !mediaType || !mediaUrl) {
    return res.status(400).json({ error: 'huntId, promptId, mediaType, mediaUrl are required' });
  }

  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  if (changed) await writeState(state);

  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });
  if (hunt.status === 'ended') return res.status(400).json({ error: 'hunt has ended' });

  const participant = requireParticipant(req, res, state, huntId);
  if (!participant) return;

  const prompt = state.prompts.find((candidate) => candidate.id === promptId && candidate.huntId === huntId);
  if (!prompt) return res.status(400).json({ error: 'prompt not found in hunt' });

  if (mediaType !== 'photo' && mediaType !== 'clip') {
    return res.status(400).json({ error: 'mediaType must be photo or clip' });
  }

  if (mediaType === 'clip') {
    if (!thumbnailUrl) return res.status(400).json({ error: 'thumbnailUrl is required for clip submissions' });
    if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) {
      return res.status(400).json({ error: 'clipDurationSeconds is required for clip submissions' });
    }
    if (clipDurationSeconds > hunt.settings.clipMaxSeconds) {
      return res.status(400).json({ error: `clip exceeds max seconds (${hunt.settings.clipMaxSeconds})` });
    }
  }

  const submission = {
    id: randomUUID(),
    huntId,
    promptId,
    participantId: participant.id,
    mediaType,
    mediaUrl,
    thumbnailUrl,
    caption,
    createdAt: nowIso(),
    status: 'active',
    isHostPick: false,
    isPinned: false,
    pinnedAt: null,
    awardKey: null,
    inRecap: false
  };

  state.submissions.push(submission);
  await writeState(state);

  const countsBySubmission = reactionCountMapForHunt(state, huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, huntId);

  res.status(201).json({
    submission: serializeSubmission(
      submission,
      state,
      participant.id,
      countsBySubmission,
      nominationsBySubmission
    )
  });
});

app.get('/api/hunts/:huntId/feed', async (req, res) => {
  const { huntId } = req.params;
  const filter = cleanString(req.query.filter).toLowerCase();
  const promptId = cleanString(req.query.promptId);

  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  if (changed) await writeState(state);

  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  const viewerParticipant = resolveParticipantForHunt(state, huntId, getTokenFromReq(req));
  const countsBySubmission = reactionCountMapForHunt(state, huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, huntId);

  let submissions = state.submissions.filter(
    (submission) => submission.huntId === huntId && submission.status === 'active'
  );

  if (promptId) submissions = submissions.filter((submission) => submission.promptId === promptId);

  if (filter === 'host_picks') {
    submissions = submissions.filter((submission) => submission.isHostPick);
    submissions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } else if (filter === 'nominated') {
    submissions.sort((a, b) => {
      const nominationDiff =
        (nominationsBySubmission.get(b.id) || 0) - (nominationsBySubmission.get(a.id) || 0);
      if (nominationDiff !== 0) return nominationDiff;
      return b.createdAt.localeCompare(a.createdAt);
    });
  } else {
    sortFeedSubmissions(submissions);
  }

  const items = submissions.map((submission) =>
    serializeSubmission(
      submission,
      state,
      viewerParticipant?.id || null,
      countsBySubmission,
      nominationsBySubmission
    )
  );

  res.json({
    hunt: serializeHunt(hunt, state),
    items,
    lastSyncAt: nowIso()
  });
});

app.get('/api/hunts/:huntId/host-queue', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  if (changed) await writeState(state);

  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  const host = requireHost(req, res, state, huntId);
  if (!host) return;

  const countsBySubmission = reactionCountMapForHunt(state, huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, huntId);

  const queue = state.submissions
    .filter((submission) => submission.huntId === huntId && submission.status === 'active')
    .sort((a, b) => {
      const nominationDiff =
        (nominationsBySubmission.get(b.id) || 0) - (nominationsBySubmission.get(a.id) || 0);
      if (nominationDiff !== 0) return nominationDiff;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .map((submission) =>
      serializeSubmission(submission, state, host.id, countsBySubmission, nominationsBySubmission)
    );

  res.json({ queue, lastSyncAt: nowIso() });
});

app.patch('/api/submissions/:submissionId/curate', async (req, res) => {
  const submissionId = cleanString(req.params.submissionId);
  const state = await readState();
  const submission = getSubmission(state, submissionId);
  if (!submission || submission.status !== 'active') {
    return res.status(404).json({ error: 'submission not found' });
  }

  const host = requireHost(req, res, state, submission.huntId);
  if (!host) return;

  if (typeof req.body?.isHostPick === 'boolean') submission.isHostPick = req.body.isHostPick;
  if (typeof req.body?.inRecap === 'boolean') submission.inRecap = req.body.inRecap;

  if (typeof req.body?.isPinned === 'boolean') {
    submission.isPinned = req.body.isPinned;
    submission.pinnedAt = submission.isPinned ? nowIso() : null;
  }

  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'awardKey')) {
    const nextAward = req.body.awardKey;
    if (nextAward === null || nextAward === '') {
      submission.awardKey = null;
    } else if (AWARD_KEYS.includes(nextAward)) {
      submission.awardKey = nextAward;
    } else {
      return res.status(400).json({ error: `awardKey must be one of ${AWARD_KEYS.join(', ')}` });
    }
  }

  await writeState(state);

  const countsBySubmission = reactionCountMapForHunt(state, submission.huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, submission.huntId);

  res.json({
    submission: serializeSubmission(submission, state, host.id, countsBySubmission, nominationsBySubmission)
  });
});

app.post('/api/submissions/:submissionId/remove', async (req, res) => {
  const submissionId = cleanString(req.params.submissionId);
  const state = await readState();
  const submission = getSubmission(state, submissionId);
  if (!submission) return res.status(404).json({ error: 'submission not found' });

  const host = requireHost(req, res, state, submission.huntId);
  if (!host) return;

  submission.status = 'removed';
  await writeState(state);

  res.json({ ok: true });
});

app.post('/api/submissions/:submissionId/react', async (req, res) => {
  const submissionId = cleanString(req.params.submissionId);
  const type = cleanString(req.body?.type);
  if (!REACTION_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${REACTION_TYPES.join(', ')}` });
  }

  const state = await readState();
  const submission = getSubmission(state, submissionId);
  if (!submission || submission.status !== 'active') {
    return res.status(404).json({ error: 'submission not found' });
  }

  const participant = requireParticipant(req, res, state, submission.huntId);
  if (!participant) return;

  const existingIndex = state.reactions.findIndex(
    (reaction) =>
      reaction.submissionId === submissionId &&
      reaction.participantId === participant.id &&
      reaction.type === type
  );

  if (existingIndex >= 0) {
    state.reactions.splice(existingIndex, 1);
  } else {
    state.reactions.push({
      id: randomUUID(),
      submissionId,
      participantId: participant.id,
      type,
      createdAt: nowIso()
    });
  }

  await writeState(state);

  const countsBySubmission = reactionCountMapForHunt(state, submission.huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, submission.huntId);

  res.json({
    submission: serializeSubmission(
      submission,
      state,
      participant.id,
      countsBySubmission,
      nominationsBySubmission
    )
  });
});

app.post('/api/submissions/:submissionId/nominate', async (req, res) => {
  const submissionId = cleanString(req.params.submissionId);
  const state = await readState();
  const submission = getSubmission(state, submissionId);
  if (!submission || submission.status !== 'active') {
    return res.status(404).json({ error: 'submission not found' });
  }

  const participant = requireParticipant(req, res, state, submission.huntId);
  if (!participant) return;

  const existingIndex = state.nominations.findIndex(
    (nomination) =>
      nomination.submissionId === submissionId && nomination.participantId === participant.id
  );

  if (existingIndex >= 0) {
    state.nominations.splice(existingIndex, 1);
  } else {
    state.nominations.push({
      id: randomUUID(),
      submissionId,
      participantId: participant.id,
      createdAt: nowIso()
    });
  }

  await writeState(state);

  const countsBySubmission = reactionCountMapForHunt(state, submission.huntId);
  const nominationsBySubmission = nominationCountMapForHunt(state, submission.huntId);

  res.json({
    submission: serializeSubmission(
      submission,
      state,
      participant.id,
      countsBySubmission,
      nominationsBySubmission
    )
  });
});

app.get('/api/hunts/:huntId/recap', async (req, res) => {
  const { huntId } = req.params;
  const state = await readState();
  const changed = autoEndExpiredHunts(state);
  if (changed) await writeState(state);

  const hunt = getHunt(state, huntId);
  if (!hunt) return res.status(404).json({ error: 'hunt not found' });

  res.json({ hunt: serializeHunt(hunt, state), ...buildRecapPayload(state, huntId) });
});

app.listen(PORT, () => {
  console.log(`Weekend World Hunt API running at http://localhost:${PORT}`);
});

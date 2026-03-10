import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';

type HuntStatus = 'draft' | 'live' | 'ended';
type Role = 'host' | 'player';
type MediaType = 'photo' | 'clip';
type ReactionType = 'fire' | 'lol' | 'wow' | 'brain';
type AwardKey = 'BEST_EYE' | 'FUNNIEST' | 'CURSED' | 'CINEMATIC' | 'NPC_ENERGY';
type MediaHint = 'photo_ok' | 'clip_encouraged';

type Hunt = {
  id: string;
  title: string;
  status: HuntStatus;
  createdAt: string;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number;
  createdByParticipantId: string;
  inviteCode: string;
  participantCount: number;
  settings: {
    allowUploadsFromCameraRoll: boolean;
    allowInAppCapture: boolean;
    clipMaxSeconds: number;
    allowComments: boolean;
    allowNominations: boolean;
  };
};

type Prompt = {
  id: string;
  huntId: string;
  code: string;
  title: string;
  description: string;
  mediaHint: MediaHint;
};

type Participant = {
  id: string;
  huntId: string;
  callsign: string;
  role: Role;
  avatarUrl: string | null;
  joinedAt: string;
};

type ReactionCounts = {
  fire: number;
  lol: number;
  wow: number;
  brain: number;
};

type SubmissionItem = {
  id: string;
  huntId: string;
  promptId: string;
  participantId: string;
  mediaType: MediaType;
  mediaUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  createdAt: string;
  status: 'active' | 'removed';
  isHostPick: boolean;
  isPinned: boolean;
  pinnedAt: string | null;
  awardKey: AwardKey | null;
  inRecap: boolean;
  prompt: Prompt | null;
  participant: Participant | null;
  reactionCounts: ReactionCounts;
  nominationCount: number;
  myReactions: ReactionType[];
  nominatedByMe: boolean;
};

type RecapData = {
  pinned: SubmissionItem[];
  hostPicks: SubmissionItem[];
  recapSelections: SubmissionItem[];
  awards: Record<string, SubmissionItem[]>;
};

type RouteState =
  | { kind: 'home' }
  | { kind: 'join'; inviteCode: string }
  | { kind: 'publicRecap'; huntId: string };

type AppScreen = 'home' | 'create' | 'join' | 'lobby' | 'main' | 'publicRecap';
type MainTab = 'feed' | 'prompts' | 'host' | 'recap';
type FeedFilter = 'all' | 'host_picks' | 'nominated';

const DEVICE_TOKEN_KEY = 'wwh_device_session_token';
const LAST_HUNT_KEY = 'wwh_last_hunt_id';

const DURATION_PRESETS = [
  { label: '60m', value: 60 },
  { label: '3h', value: 180 },
  { label: '24h', value: 1440 }
];

const REACTION_LABELS: Record<ReactionType, string> = {
  fire: 'FIRE',
  lol: 'LOL',
  wow: 'WOW',
  brain: 'BRAIN'
};

const AWARD_LABELS: Record<AwardKey, string> = {
  BEST_EYE: 'Best Eye',
  FUNNIEST: 'Funniest',
  CURSED: 'Cursed',
  CINEMATIC: 'Cinematic',
  NPC_ENERGY: 'NPC Energy'
};

const parseRoute = (pathname: string): RouteState => {
  const joinMatch = pathname.match(/^\/join\/([A-Za-z0-9-]+)$/);
  if (joinMatch) {
    return { kind: 'join', inviteCode: joinMatch[1].toUpperCase() };
  }

  const recapMatch = pathname.match(/^\/hunt\/([a-f0-9-]+)\/recap$/i);
  if (recapMatch) {
    return { kind: 'publicRecap', huntId: recapMatch[1] };
  }

  return { kind: 'home' };
};

const buildAbsoluteMediaUrl = (url: string) => {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${window.location.origin}${url}`;
};

const getOrCreateDeviceToken = () => {
  const existing = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (existing) return existing;
  const generated = `sess_${crypto.randomUUID()}`;
  localStorage.setItem(DEVICE_TOKEN_KEY, generated);
  return generated;
};

const formatTimeRemaining = (endsAt: string | null) => {
  if (!endsAt) return '--:--:--';
  const ms = Date.parse(endsAt) - Date.now();
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const formatRelativeAgo = (createdAt: string) => {
  const diffMs = Date.now() - Date.parse(createdAt);
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'NOW';
  if (diffMin < 60) return `${diffMin}M AGO`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
};

const toDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('unable to read selected file'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error('unable to read selected file'));
    reader.readAsDataURL(file);
  });

const readVideoDuration = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('unable to read clip metadata'));
    };
  });

const makeVideoThumbnail = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);

    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(video.videoWidth, 240);
      canvas.height = Math.max(video.videoHeight, 320);
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(video.src);
        reject(new Error('unable to generate video thumbnail'));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('unable to generate video thumbnail'));
    };
  });

function App() {
  const [routeState, setRouteState] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [screen, setScreen] = useState<AppScreen>('home');

  const [deviceToken] = useState(() => getOrCreateDeviceToken());

  const [hunt, setHunt] = useState<Hunt | null>(null);
  const [me, setMe] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [feedItems, setFeedItems] = useState<SubmissionItem[]>([]);
  const [queueItems, setQueueItems] = useState<SubmissionItem[]>([]);
  const [recapData, setRecapData] = useState<RecapData | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string>('');

  const [mainTab, setMainTab] = useState<MainTab>('feed');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [feedPromptId, setFeedPromptId] = useState<string>('');

  const [createTitle, setCreateTitle] = useState('Weekend World Hunt');
  const [createDuration, setCreateDuration] = useState(180);
  const [createCallsign, setCreateCallsign] = useState('ADMIN_01');

  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [joinCallsign, setJoinCallsign] = useState('AGENT');

  const [resumableHunt, setResumableHunt] = useState<Hunt | null>(null);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitPromptId, setSubmitPromptId] = useState('');
  const [submitMediaType, setSubmitMediaType] = useState<MediaType>('photo');
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [submitCaption, setSubmitCaption] = useState('');
  const [clipDurationSeconds, setClipDurationSeconds] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [mySubmittedPromptIds, setMySubmittedPromptIds] = useState<Set<string>>(new Set());

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setRouteState(parseRoute(path));
  }, []);

  useEffect(() => {
    const onPopState = () => setRouteState(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers || {});
      if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }
      headers.set('X-Session-Token', deviceToken);

      const response = await fetch(path, {
        ...init,
        headers
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const parsed = (await response.json()) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // no-op; fallback to status
        }
        throw new Error(message);
      }

      return (await response.json()) as T;
    },
    [deviceToken]
  );

  const refreshHunt = useCallback(
    async (huntId: string) => {
      const [huntPayload, promptsPayload] = await Promise.all([
        api<{ hunt: Hunt; me: Participant | null; participants: Participant[] }>(`/api/hunts/${huntId}`),
        api<{ prompts: Prompt[] }>(`/api/hunts/${huntId}/prompts`)
      ]);
      setHunt(huntPayload.hunt);
      setMe(huntPayload.me);
      setParticipants(huntPayload.participants);
      setPrompts(promptsPayload.prompts);
      localStorage.setItem(LAST_HUNT_KEY, huntId);

      if (huntPayload.hunt.status === 'draft') {
        setScreen('lobby');
      } else {
        setScreen('main');
      }
    },
    [api]
  );

  const refreshFeed = useCallback(
    async (huntId: string, filter: FeedFilter, promptId: string, meId: string | null) => {
      const feedPath = `/api/hunts/${huntId}/feed${
        filter !== 'all' || promptId
          ? `?${new URLSearchParams({
              ...(filter !== 'all' ? { filter } : {}),
              ...(promptId ? { promptId } : {})
            }).toString()}`
          : ''
      }`;

      const [activeFeed, allFeed] = await Promise.all([
        api<{ items: SubmissionItem[]; lastSyncAt: string }>(feedPath),
        api<{ items: SubmissionItem[]; lastSyncAt: string }>(`/api/hunts/${huntId}/feed`)
      ]);

      setFeedItems(activeFeed.items);
      setLastSyncAt(activeFeed.lastSyncAt);
      if (meId) {
        const mine = new Set(
          allFeed.items
            .filter((submission) => submission.participant?.id === meId)
            .map((submission) => submission.promptId)
        );
        setMySubmittedPromptIds(mine);
      }
    },
    [api]
  );

  const refreshHostQueue = useCallback(
    async (huntId: string, role: Role | null) => {
      if (role !== 'host') {
        setQueueItems([]);
        return;
      }
      const payload = await api<{ queue: SubmissionItem[] }>(`/api/hunts/${huntId}/host-queue`);
      setQueueItems(payload.queue);
    },
    [api]
  );

  const refreshRecap = useCallback(
    async (huntId: string) => {
      const payload = await api<{ hunt: Hunt } & RecapData>(`/api/hunts/${huntId}/recap`);
      setRecapData({
        pinned: payload.pinned,
        hostPicks: payload.hostPicks,
        recapSelections: payload.recapSelections,
        awards: payload.awards
      });
      return payload.hunt;
    },
    [api]
  );

  useEffect(() => {
    const hydrate = async () => {
      if (routeState.kind === 'join') {
        setJoinInviteCode(routeState.inviteCode);
        setScreen('join');
        return;
      }

      if (routeState.kind === 'publicRecap') {
        setScreen('publicRecap');
        try {
          const recapHunt = await refreshRecap(routeState.huntId);
          setHunt(recapHunt);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unable to load recap';
          setStatusMessage(message);
        }
        return;
      }

      setScreen('home');
      const lastHuntId = localStorage.getItem(LAST_HUNT_KEY);
      if (!lastHuntId) {
        setResumableHunt(null);
        return;
      }

      try {
        const payload = await api<{ hunt: Hunt; me: Participant | null }>(`/api/hunts/${lastHuntId}`);
        if (payload.me) {
          setResumableHunt(payload.hunt);
        } else {
          setResumableHunt(null);
        }
      } catch {
        setResumableHunt(null);
      }
    };

    void hydrate();
  }, [api, refreshRecap, routeState]);

  useEffect(() => {
    if (!hunt || screen !== 'main') return;

    const runRefresh = async () => {
      try {
        await refreshHunt(hunt.id);
        await refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null);
        await refreshHostQueue(hunt.id, me?.role || null);
        if (hunt.status === 'ended' || mainTab === 'recap') {
          await refreshRecap(hunt.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'sync failed';
        setStatusMessage(message);
      }
    };

    void runRefresh();
    if (hunt.status !== 'live') return;

    const interval = window.setInterval(() => {
      void runRefresh();
    }, 12000);

    return () => window.clearInterval(interval);
  }, [
    feedFilter,
    feedPromptId,
    hunt,
    mainTab,
    me?.id,
    me?.role,
    refreshFeed,
    refreshHostQueue,
    refreshHunt,
    refreshRecap,
    screen
  ]);

  useEffect(() => {
    if (!hunt || screen !== 'main') return;
    void refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null);
  }, [feedFilter, feedPromptId, hunt, me?.id, refreshFeed, screen]);

  useEffect(() => {
    if (mainTab !== 'prompts' && activePromptId) {
      setActivePromptId(null);
    }
  }, [activePromptId, mainTab]);

  const onCreateHunt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatusMessage('');
    try {
      const payload = await api<{ hunt: Hunt; participant: Participant }>(`/api/hunts`, {
        method: 'POST',
        body: JSON.stringify({
          title: createTitle,
          durationMinutes: createDuration,
          callsign: createCallsign,
          deviceSessionToken: deviceToken
        })
      });
      await refreshHunt(payload.hunt.id);
      setMe(payload.participant);
      setMainTab('feed');
      setStatusMessage(`Mission created. Invite code ${payload.hunt.inviteCode}`);
      navigate('/');
      setScreen('lobby');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'unable to create hunt');
    } finally {
      setBusy(false);
    }
  };

  const onJoinHunt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatusMessage('');

    try {
      const invitePayload = await api<{ hunt: Hunt }>(`/api/hunts/by-invite/${joinInviteCode.toUpperCase()}`);
      const targetHuntId = invitePayload.hunt.id;
      await api<{ participant: Participant }>(`/api/hunts/${targetHuntId}/join`, {
        method: 'POST',
        body: JSON.stringify({
          callsign: joinCallsign,
          deviceSessionToken: deviceToken
        })
      });
      await refreshHunt(targetHuntId);
      setMainTab('feed');
      navigate('/');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'unable to join hunt');
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (!resumableHunt) return;
    setBusy(true);
    setStatusMessage('');
    try {
      await refreshHunt(resumableHunt.id);
      setMainTab('feed');
      navigate('/');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'unable to resume hunt');
    } finally {
      setBusy(false);
    }
  };

  const onStartHunt = async () => {
    if (!hunt) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const payload = await api<{ hunt: Hunt }>(`/api/hunts/${hunt.id}/start`, { method: 'POST' });
      setHunt(payload.hunt);
      setScreen('main');
      setMainTab('feed');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'unable to start hunt');
    } finally {
      setBusy(false);
    }
  };

  const onEndHunt = async () => {
    if (!hunt) return;
    setBusy(true);
    setStatusMessage('');
    try {
      const payload = await api<{ hunt: Hunt }>(`/api/hunts/${hunt.id}/end`, { method: 'POST' });
      setHunt(payload.hunt);
      setMainTab('recap');
      await refreshRecap(payload.hunt.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'unable to end hunt');
    } finally {
      setBusy(false);
    }
  };

  const openSubmitForPrompt = (promptId: string) => {
    setSubmitPromptId(promptId);
    setSubmitMediaType('photo');
    setSubmitFile(null);
    setSubmitCaption('');
    setClipDurationSeconds(null);
    setSubmitError('');
    setSubmitOpen(true);
  };

  const onChangeSubmitFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setSubmitError('');
    setSubmitFile(null);
    setClipDurationSeconds(null);

    if (!nextFile) return;

    try {
      if (submitMediaType === 'photo') {
        if (!nextFile.type.startsWith('image/')) {
          throw new Error('PHOTO mode requires an image file');
        }
        setSubmitFile(nextFile);
        return;
      }

      if (!nextFile.type.startsWith('video/')) {
        throw new Error('CLIP mode requires a video file');
      }
      const duration = await readVideoDuration(nextFile);
      const clipMaxSeconds = hunt?.settings.clipMaxSeconds ?? 7;
      if (duration > clipMaxSeconds) {
        throw new Error(`Clip is ${duration.toFixed(1)}s. Max is ${clipMaxSeconds}s.`);
      }
      setClipDurationSeconds(duration);
      setSubmitFile(nextFile);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'invalid file');
    }
  };

  const onSubmitManifest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hunt || !submitPromptId || !submitFile) {
      setSubmitError('Select a prompt and media file first.');
      return;
    }

    setBusy(true);
    setSubmitError('');

    try {
      const dataUrl = await toDataUrl(submitFile);
      const thumbnailDataUrl =
        submitMediaType === 'clip' ? await makeVideoThumbnail(submitFile) : undefined;

      const uploadPayload = await api<{ mediaUrl: string; thumbnailUrl: string | null }>(`/api/upload`, {
        method: 'POST',
        body: JSON.stringify({
          dataUrl,
          mediaType: submitMediaType,
          ...(thumbnailDataUrl ? { thumbnailDataUrl } : {})
        })
      });

      await api<{ submission: SubmissionItem }>(`/api/submissions`, {
        method: 'POST',
        body: JSON.stringify({
          huntId: hunt.id,
          promptId: submitPromptId,
          mediaType: submitMediaType,
          mediaUrl: uploadPayload.mediaUrl,
          thumbnailUrl: uploadPayload.thumbnailUrl,
          caption: submitCaption,
          clipDurationSeconds
        })
      });

      setSubmitOpen(false);
      setSubmitFile(null);
      setSubmitCaption('');
      setClipDurationSeconds(null);
      await refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null);
      if (me?.role === 'host') {
        await refreshHostQueue(hunt.id, me.role);
      }
      setMainTab('feed');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'submit failed');
    } finally {
      setBusy(false);
    }
  };

  const onReact = async (submissionId: string, type: ReactionType) => {
    if (!hunt) return;
    try {
      await api(`/api/submissions/${submissionId}/react`, {
        method: 'POST',
        body: JSON.stringify({ type })
      });
      await refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'reaction failed');
    }
  };

  const onNominate = async (submissionId: string) => {
    if (!hunt) return;
    try {
      await api(`/api/submissions/${submissionId}/nominate`, {
        method: 'POST'
      });
      await Promise.all([
        refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null),
        refreshHostQueue(hunt.id, me?.role || null)
      ]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'nomination failed');
    }
  };

  const onCurate = async (submissionId: string, patch: Record<string, boolean | string | null>) => {
    if (!hunt) return;
    try {
      await api(`/api/submissions/${submissionId}/curate`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await Promise.all([
        refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null),
        refreshHostQueue(hunt.id, me?.role || null),
        refreshRecap(hunt.id)
      ]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'curation failed');
    }
  };

  const onRemoveSubmission = async (submissionId: string) => {
    if (!hunt) return;
    try {
      await api(`/api/submissions/${submissionId}/remove`, { method: 'POST' });
      await Promise.all([
        refreshFeed(hunt.id, feedFilter, feedPromptId, me?.id || null),
        refreshHostQueue(hunt.id, me?.role || null),
        refreshRecap(hunt.id)
      ]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'remove failed');
    }
  };

  const onCopyInvite = async () => {
    if (!hunt) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${hunt.inviteCode}`);
      setStatusMessage('Invite link copied.');
    } catch {
      setStatusMessage('Clipboard access not available.');
    }
  };

  const onCopyRecap = async () => {
    if (!hunt) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/hunt/${hunt.id}/recap`);
      setStatusMessage('Recap link copied.');
    } catch {
      setStatusMessage('Clipboard access not available.');
    }
  };

  const feedPromptOptions = useMemo(() => {
    if (!prompts.length) return [];
    return prompts.map((prompt) => ({ value: prompt.id, label: `${prompt.code} // ${prompt.title}` }));
  }, [prompts]);

  const activePrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === activePromptId) || null,
    [activePromptId, prompts]
  );
  const submitPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === submitPromptId) || null,
    [prompts, submitPromptId]
  );

  const renderSubmissionCard = (submission: SubmissionItem, hostControls = false) => (
    <article key={submission.id} className="card feed-card">
      <div className="card-media-wrap">
        {submission.mediaType === 'photo' ? (
          <img src={buildAbsoluteMediaUrl(submission.mediaUrl)} alt={submission.prompt?.title || 'submission'} className="card-media" />
        ) : (
          <video
            className="card-media"
            controls
            poster={submission.thumbnailUrl ? buildAbsoluteMediaUrl(submission.thumbnailUrl) : undefined}
            src={buildAbsoluteMediaUrl(submission.mediaUrl)}
          />
        )}
        <div className="status-overlay">
          <span className={`badge ${submission.mediaType === 'clip' ? 'blink rec' : ''}`}>
            {submission.mediaType === 'clip' ? '[ REC ]' : 'IMAGE_CAP'}
          </span>
          {submission.mediaType === 'clip' && (
            <span className="badge">CLIP_{submission.id.slice(0, 3).toUpperCase()}</span>
          )}
          {submission.awardKey && <span className="badge">{AWARD_LABELS[submission.awardKey].toUpperCase()}</span>}
          {submission.isPinned && <span className="badge">PINNED</span>}
        </div>
        {submission.isHostPick && <div className="host-pick-stamp">HOST PICK</div>}
      </div>
      <div className="card-info">
        <div className="meta-row">
          {submission.prompt?.code || 'UNK'} // @{submission.participant?.callsign || 'ANON'} //{' '}
          {formatRelativeAgo(submission.createdAt)}
        </div>
        {submission.caption && <p className="caption">{submission.caption}</p>}
        <div className="action-row">
          <div className="reaction-chips">
          {(Object.keys(REACTION_LABELS) as ReactionType[]).map((reactionType) => (
            <button
              key={reactionType}
              type="button"
              className={`chip ${submission.myReactions.includes(reactionType) ? 'active' : ''}`}
              onClick={() => void onReact(submission.id, reactionType)}
            >
              {REACTION_LABELS[reactionType]} {submission.reactionCounts[reactionType]}
            </button>
          ))}
          </div>
          <button
            type="button"
            className={`nominate-btn ${submission.nominatedByMe ? 'active' : ''}`}
            onClick={() => void onNominate(submission.id)}
          >
            NOMINATE [{submission.nominationCount}]
          </button>
        </div>
      </div>
      {hostControls && (
        <div className="host-controls">
          <button type="button" onClick={() => void onCurate(submission.id, { isHostPick: !submission.isHostPick })}>
            {submission.isHostPick ? 'UNMARK HOST PICK' : 'HOST PICK'}
          </button>
          <button type="button" onClick={() => void onCurate(submission.id, { inRecap: !submission.inRecap })}>
            {submission.inRecap ? 'REMOVE RECAP' : 'ADD RECAP'}
          </button>
          <button type="button" onClick={() => void onCurate(submission.id, { isPinned: !submission.isPinned })}>
            {submission.isPinned ? 'UNPIN' : 'PIN TO TOP'}
          </button>
          <select
            value={submission.awardKey || ''}
            onChange={(event) =>
              void onCurate(submission.id, { awardKey: event.target.value || null })
            }
          >
            <option value="">NO AWARD</option>
            {Object.entries(AWARD_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="danger" onClick={() => void onRemoveSubmission(submission.id)}>
            REMOVE
          </button>
        </div>
      )}
    </article>
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logo-main">
          {screen === 'main' && mainTab === 'feed' ? 'SQUAD_STREAM' : 'WEEKEND WORLD HUNT'}
        </div>
        {hunt && (
          <div className="header-status">
            <span className={`live-dot ${hunt.status}`} />
            <span className="live-time">LIVE: {formatTimeRemaining(hunt.endsAt)}</span>
          </div>
        )}
      </header>

      {statusMessage && <div className="status-bar">{statusMessage}</div>}

      {screen === 'home' && (
        <main className="panel stack">
          <button className="primary" type="button" onClick={() => setScreen('create')}>
            CREATE HUNT
          </button>

          <button className="ghost" type="button" onClick={() => setScreen('join')}>
            JOIN WITH INVITE CODE
          </button>

          {resumableHunt && (
            <div className="resume-card">
              <div className="mono">ACTIVE SESSION DETECTED</div>
              <strong>{resumableHunt.title}</strong>
              <div className="mono">{resumableHunt.inviteCode}</div>
              <button type="button" onClick={() => void onResume()} disabled={busy}>
                RESUME HUNT
              </button>
            </div>
          )}
        </main>
      )}

      {screen === 'create' && (
        <main className="panel stack">
          <form className="stack" onSubmit={(event) => void onCreateHunt(event)}>
            <label className="mono" htmlFor="hunt-title">
              HUNT TITLE
            </label>
            <input
              id="hunt-title"
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              maxLength={60}
              required
            />

            <label className="mono" htmlFor="host-callsign">
              HOST CALLSIGN
            </label>
            <input
              id="host-callsign"
              value={createCallsign}
              onChange={(event) => setCreateCallsign(event.target.value)}
              maxLength={24}
              required
            />

            <label className="mono">DURATION</label>
            <div className="segment-row">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={createDuration === preset.value ? 'segment active' : 'segment'}
                  onClick={() => setCreateDuration(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button className="primary" disabled={busy} type="submit">
              {busy ? 'CREATING...' : 'DEPLOY HUNT'}
            </button>
          </form>

          <button type="button" className="ghost" onClick={() => setScreen('home')}>
            BACK
          </button>
        </main>
      )}

      {screen === 'join' && (
        <main className="panel stack">
          <form className="stack" onSubmit={(event) => void onJoinHunt(event)}>
            <label className="mono" htmlFor="invite-code">
              INVITE CODE
            </label>
            <input
              id="invite-code"
              value={joinInviteCode}
              onChange={(event) => setJoinInviteCode(event.target.value.toUpperCase())}
              placeholder="HX-992-K"
              required
            />

            <label className="mono" htmlFor="player-callsign">
              CALLSIGN
            </label>
            <input
              id="player-callsign"
              value={joinCallsign}
              onChange={(event) => setJoinCallsign(event.target.value)}
              required
            />

            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'JOINING...' : 'JOIN HUNT'}
            </button>
          </form>

          <button type="button" className="ghost" onClick={() => setScreen('home')}>
            BACK
          </button>
        </main>
      )}

      {screen === 'lobby' && hunt && (
        <main className="panel stack">
          <section className="stack">
            <div className="mono">HUNT // {hunt.title}</div>
            <div className="invite-box">
              <strong>{hunt.inviteCode}</strong>
              <button type="button" onClick={() => void onCopyInvite()}>
                COPY LINK
              </button>
            </div>
            <div className="mono">{window.location.origin}/join/{hunt.inviteCode}</div>
          </section>

          <section className="stack">
            <div className="mono">SQUAD ({participants.length})</div>
            <div className="callsign-grid">
              {participants.map((participant) => (
                <div key={participant.id} className="callsign-pill">
                  {participant.callsign}
                  {participant.role === 'host' && ' // HOST'}
                </div>
              ))}
            </div>
          </section>

          {me?.role === 'host' && hunt.status === 'draft' && (
            <button type="button" className="primary" onClick={() => void onStartHunt()} disabled={busy}>
              START HUNT
            </button>
          )}

          {(hunt.status === 'live' || hunt.status === 'ended') && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setScreen('main');
                setMainTab('feed');
              }}
            >
              ENTER FEED
            </button>
          )}

          <button type="button" className="ghost" onClick={() => setScreen('home')}>
            EXIT TO HOME
          </button>
        </main>
      )}

      {screen === 'main' && hunt && me && (
        <main className="panel shell">
          <div className="shell-header">
            <div className="mono">
              {hunt.title} // @{me.callsign}
            </div>
            <div className="mono">LAST SYNC {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : '--:--'}</div>
          </div>

          {mainTab === 'feed' && (
            <section className="feed-surface">
              <div className="feed-controls">
                <select value={feedFilter} onChange={(event) => setFeedFilter(event.target.value as FeedFilter)}>
                  <option value="all">ALL</option>
                  <option value="host_picks">HOST PICKS</option>
                  <option value="nominated">NOMINATED</option>
                </select>
                <select value={feedPromptId} onChange={(event) => setFeedPromptId(event.target.value)}>
                  <option value="">ALL PROMPTS</option>
                  {feedPromptOptions.map((prompt) => (
                    <option key={prompt.value} value={prompt.value}>
                      {prompt.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => openSubmitForPrompt(feedPromptId || prompts[0]?.id || '')}>
                  SUBMIT
                </button>
              </div>

              <div id="feed-container" className="feed-list">
                {feedItems.length === 0 && <div className="empty">No signals yet. Deploy first capture.</div>}
                {feedItems.map((submission) => renderSubmissionCard(submission, false))}
              </div>
            </section>
          )}

          {mainTab === 'prompts' && (
            <section className="stack prompt-surface">
              {!activePrompt &&
                prompts.map((prompt) => {
                  const submitted = mySubmittedPromptIds.has(prompt.id);
                  return (
                    <article key={prompt.id} className="prompt-row">
                      <div>
                        <div className="mono">{prompt.code}</div>
                        <strong>{prompt.title}</strong>
                        <p>{prompt.description}</p>
                      </div>
                      <div className="prompt-cta">
                        <span className={submitted ? 'badge submitted' : 'badge'}>
                          {submitted ? 'SUBMITTED' : 'OPEN'}
                        </span>
                        <button type="button" onClick={() => setActivePromptId(prompt.id)}>
                          DETAIL
                        </button>
                        <button type="button" onClick={() => openSubmitForPrompt(prompt.id)}>
                          SUBMIT
                        </button>
                      </div>
                    </article>
                  );
                })}

              {activePrompt && (
                <article className="prompt-detail">
                  <button type="button" className="mono back-nav" onClick={() => setActivePromptId(null)}>
                    &larr; BACK_TO_MANIFEST
                  </button>

                  <div className="prompt-header-block">
                    <div className="mono prompt-id">OBJECTIVE_ID: {activePrompt.code}</div>
                    <h2 className="prompt-title">{activePrompt.title}</h2>
                    <div className="badge-row">
                      <div className="point-badge">+450 XP</div>
                      <div className="difficulty-stars">
                        {activePrompt.mediaHint === 'clip_encouraged' ? '★★★★☆' : '★★★☆☆'}
                      </div>
                    </div>
                  </div>

                  <div className="box">
                    <div className="box-header">
                      <span>MISSION_DESCRIPTION</span>
                      <span>PRIORITY_02</span>
                    </div>
                    <div className="box-content">{activePrompt.description.toUpperCase()}.</div>
                  </div>

                  <div className="box">
                    <div className="box-header">
                      <span>CONSTRAINTS_&amp;_RULES</span>
                      <span>V.104</span>
                    </div>
                    <div className="box-content">
                      <ul>
                        <li>Must be a physical object context.</li>
                        <li>No post-editing overlays.</li>
                        <li>Ensure objective is clearly visible.</li>
                        <li>Submit before mission timeout.</li>
                      </ul>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="primary prompt-init"
                    onClick={() => openSubmitForPrompt(activePrompt.id)}
                  >
                    INITIALIZE CAMERA <span>⊙</span>
                  </button>
                </article>
              )}
            </section>
          )}

          {mainTab === 'host' && me.role === 'host' && (
            <section className="stack">
              <div className="mono">QUEUE PRIORITY: NOMINATED -&gt; NEWEST</div>
              {queueItems.length === 0 && <div className="empty">No submissions to curate.</div>}
              {queueItems.map((submission) => renderSubmissionCard(submission, true))}
            </section>
          )}

          {mainTab === 'recap' && (
            <section className="stack">
              <div className="recap-header">
                <strong>MISSION COMPLETE SUMMARY</strong>
                <button type="button" onClick={() => void onCopyRecap()}>
                  COPY SHARE LINK
                </button>
              </div>

              {!recapData && <div className="empty">No recap data yet.</div>}

              {recapData && (
                <>
                  <section className="stack">
                    <h2>PINNED</h2>
                    {recapData.pinned.length === 0 && <div className="empty">No pinned captures.</div>}
                    {recapData.pinned.map((submission) => renderSubmissionCard(submission))}
                  </section>

                  <section className="stack">
                    <h2>HOST PICKS</h2>
                    {recapData.hostPicks.length === 0 && <div className="empty">No host picks.</div>}
                    {recapData.hostPicks.map((submission) => renderSubmissionCard(submission))}
                  </section>

                  <section className="stack">
                    <h2>AWARDS</h2>
                    {(Object.keys(AWARD_LABELS) as AwardKey[]).map((key) => (
                      <div key={key} className="stack award-group">
                        <div className="mono">{AWARD_LABELS[key].toUpperCase()}</div>
                        {(recapData.awards[key] || []).length === 0 && (
                          <div className="empty">No winners yet.</div>
                        )}
                        {(recapData.awards[key] || []).map((submission) => renderSubmissionCard(submission))}
                      </div>
                    ))}
                  </section>

                  <section className="stack">
                    <h2>RECAP SELECTIONS</h2>
                    {recapData.recapSelections.length === 0 && (
                      <div className="empty">No recap selections yet.</div>
                    )}
                    {recapData.recapSelections.map((submission) => renderSubmissionCard(submission))}
                  </section>
                </>
              )}
            </section>
          )}

          <nav className="nav-bar">
            <button className={mainTab === 'feed' ? 'nav-item active' : 'nav-item'} onClick={() => setMainTab('feed')}>
              <span className="nav-icon">⌖</span>
              <span>Feed</span>
            </button>
            <button className={mainTab === 'prompts' ? 'nav-item active' : 'nav-item'} onClick={() => setMainTab('prompts')}>
              <span className="nav-icon">≣</span>
              <span>Prompts</span>
            </button>
            {me.role === 'host' ? (
              <button className={mainTab === 'host' ? 'nav-item active' : 'nav-item'} onClick={() => setMainTab('host')}>
                <span className="nav-icon">▦</span>
                <span>Host</span>
              </button>
            ) : (
              <button
                className="nav-item"
                onClick={() => {
                  setScreen('lobby');
                  setMainTab('feed');
                }}
              >
                <span className="nav-icon">▦</span>
                <span>Squad</span>
              </button>
            )}
            <button
              className={mainTab === 'recap' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setMainTab('recap');
                void refreshRecap(hunt.id);
              }}
              disabled={hunt.status !== 'ended'}
            >
              <span className="nav-icon">★</span>
              <span>Recap</span>
            </button>
          </nav>
          {me.role === 'host' && hunt.status === 'live' && (
            <button type="button" className="danger end-inline" onClick={() => void onEndHunt()}>
              END HUNT
            </button>
          )}
        </main>
      )}

      {screen === 'publicRecap' && hunt && recapData && (
        <main className="panel stack">
          <div className="recap-header">
            <strong>{hunt.title} // SHAREABLE RECAP</strong>
            <button type="button" onClick={() => navigate('/')}>
              HOME
            </button>
          </div>

          <section className="stack">
            <h2>PINNED</h2>
            {recapData.pinned.map((submission) => renderSubmissionCard(submission))}
          </section>

          <section className="stack">
            <h2>HOST PICKS</h2>
            {recapData.hostPicks.map((submission) => renderSubmissionCard(submission))}
          </section>

          <section className="stack">
            <h2>AWARDS</h2>
            {(Object.keys(AWARD_LABELS) as AwardKey[]).map((key) => (
              <div key={key} className="stack award-group">
                <div className="mono">{AWARD_LABELS[key].toUpperCase()}</div>
                {(recapData.awards[key] || []).map((submission) => renderSubmissionCard(submission))}
              </div>
            ))}
          </section>
        </main>
      )}

      {submitOpen && hunt && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="capture-shell" onSubmit={(event) => void onSubmitManifest(event)}>
            <div className="viewfinder">
              <div className="grid-overlay" />
              <div className="corner tl" />
              <div className="corner tr" />
              <div className="corner bl" />
              <div className="corner br" />

              <div className="cam-header">
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={`mode-btn ${submitMediaType === 'photo' ? 'active' : ''}`}
                    onClick={() => {
                      setSubmitMediaType('photo');
                      setSubmitFile(null);
                      setClipDurationSeconds(null);
                    }}
                  >
                    PHOTO
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${submitMediaType === 'clip' ? 'active' : ''}`}
                    onClick={() => {
                      setSubmitMediaType('clip');
                      setSubmitFile(null);
                      setClipDurationSeconds(null);
                    }}
                  >
                    CLIP
                  </button>
                </div>

                <select
                  id="submit-prompt"
                  value={submitPromptId}
                  onChange={(event) => setSubmitPromptId(event.target.value)}
                  required
                  className="prompt-select"
                >
                  <option value="">SELECT PROMPT</option>
                  {prompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.code} // {prompt.title}
                    </option>
                  ))}
                </select>

                <div className="prompt-tag">
                  <span className="dot-static" />
                  {submitPrompt ? submitPrompt.title.toUpperCase() : 'SELECT OBJECTIVE'}
                </div>
              </div>

              {submitMediaType === 'clip' && (
                <div className="rec-stamp">
                  <div className="dot" />
                  REC {clipDurationSeconds ? clipDurationSeconds.toFixed(1) : '00:00'} /{' '}
                  {hunt.settings.clipMaxSeconds.toFixed(0)}s
                </div>
              )}

              <div className="timer-track">
                <div
                  className="timer-fill"
                  style={{
                    width: `${
                      submitMediaType === 'clip' && clipDurationSeconds
                        ? Math.min(100, (clipDurationSeconds / hunt.settings.clipMaxSeconds) * 100)
                        : 0
                    }%`
                  }}
                />
              </div>
            </div>

            <div className="capture-ui">
              <div>
                <span className="manifest-id mono">TRANS_REF: {hunt.inviteCode}</span>
                <textarea
                  className="caption-field"
                  value={submitCaption}
                  onChange={(event) => setSubmitCaption(event.target.value)}
                  placeholder="ADD INTEL / CAPTION..."
                  rows={3}
                  maxLength={240}
                />
              </div>

              <input
                ref={fileInputRef}
                className="hidden-file-input"
                type="file"
                accept={submitMediaType === 'photo' ? 'image/*' : 'video/*'}
                capture="environment"
                onChange={(event) => {
                  void onChangeSubmitFile(event);
                }}
              />

              <div className="capture-actions">
                <button type="button" className="secondary-btn" onClick={() => setSubmitOpen(false)}>
                  CANCEL
                </button>

                <button
                  type="button"
                  className="shutter-ring"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="shutter-inner" />
                </button>

                <button type="button" className="secondary-btn" onClick={() => fileInputRef.current?.click()}>
                  {submitFile ? 'RETAKE' : 'UPLOAD'}
                </button>
              </div>

              {submitError && <div className="error">{submitError}</div>}

              <button type="submit" className="submit-btn" disabled={busy || !submitPromptId || !submitFile}>
                <span>{busy ? 'UPLOADING...' : 'SUBMIT MANIFEST'}</span>
                <span>&rarr;</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;

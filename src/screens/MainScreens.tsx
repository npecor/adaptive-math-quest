import type { CSSProperties, ReactNode } from 'react';
import type { MatchResults, MatchStatus } from '../lib/leaderboard-api';

export type PracticeSubjectCard = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  glow: string;
  soft: string;
};

export type ChallengeStatsView = {
  bestRun: number;
  accuracy: number;
  streak: number;
};

export type FriendMatchLobbyView = {
  matchId: string;
  role: 'host' | 'guest';
  status: MatchStatus;
  guestPlayerId: string | null;
  results: MatchResults | null;
};

export function HomeScreen({
  cadetName,
  avatar,
  stats,
  activeInvite,
  onEditProfile,
  onStartChallenge,
  onOpenPractice,
  onCreateInvite,
  onOpenInviteLobby,
  onCopyInvite
}: {
  cadetName: string;
  avatar: ReactNode;
  stats: ChallengeStatsView;
  activeInvite?: {
    status: MatchStatus;
    latestInviteLink: string | null;
    opponentDisplayName: string;
  } | null;
  onEditProfile: () => void;
  onStartChallenge: () => void;
  onOpenPractice: () => void;
  onCreateInvite: () => void;
  onOpenInviteLobby: () => void;
  onCopyInvite: () => void;
}) {
  return (
    <>
      <button
        className="card home-hero home-hero-button challenge-home-hero"
        onClick={onEditProfile}
        aria-label="Edit profile"
        type="button"
      >
        <div className="home-hero-head">
          <div className="home-hero-main">
            <div className="selected-player-avatar home-hero-avatar">{avatar}</div>
            <div className="home-hero-copy">
              <h3 className="home-hero-title">Ready for launch, {cadetName}?</h3>
            </div>
          </div>
          <span className="home-hero-edit-affordance" aria-hidden="true">›</span>
        </div>
      </button>

      <section className="card challenge-home-card challenge-home-card-primary">
        <h3 className="text-title">Solo Challenge</h3>
        <p className="muted">A fresh mission tuned to your level.</p>
        <button className="btn btn-primary" onClick={onStartChallenge}>
          Start Challenge
        </button>
        <button className="text-cta practice-instead-link" onClick={onOpenPractice}>
          Practice instead →
        </button>
      </section>

      <section className="card challenge-home-card">
        <h3 className="text-title">Challenge a Friend</h3>
        {activeInvite ? (
          <div className="challenge-home-invite-state">
            <p className="muted">
              {activeInvite.status === 'waiting'
                ? 'Invite link ready. Waiting for your friend to join.'
                : activeInvite.status === 'ready'
                  ? `${activeInvite.opponentDisplayName} joined. Head-to-head mission ready.`
                  : 'Your friend challenge is active.'}
            </p>
            {activeInvite.latestInviteLink && (
              <div className="invite-link-row challenge-home-invite-row">
                <input className="invite-link-input" value={activeInvite.latestInviteLink} readOnly aria-label="Challenge invite link" />
                <button className="btn btn-secondary invite-link-copy-btn" onClick={onCopyInvite}>
                  Copy
                </button>
              </div>
            )}
            <button className="btn btn-secondary" onClick={onOpenInviteLobby}>
              Open Lobby
            </button>
          </div>
        ) : (
          <>
            <p className="muted">Invite a friend to race through the same mission.</p>
            <button className="btn btn-secondary" onClick={onCreateInvite}>
              Create Invite Link
            </button>
          </>
        )}
      </section>

      <section className="section-header">
        <h3 className="text-title">{cadetName}'s Stats</h3>
      </section>

      <section className="card home-stats-card">
        <div className="stats-grid stats-grid-embedded challenge-stats-grid">
          <div className="stat-card">
            <span className="stat-value">{stats.bestRun}</span>
            <span className="stat-label">Best Run</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.accuracy}%</span>
            <span className="stat-label">Accuracy</span>
          </div>
          <div className="stat-card">
            <span className="stat-value accent">{stats.streak}</span>
            <span className="stat-label">Streak</span>
          </div>
        </div>
      </section>
    </>
  );
}

export function PracticeScreen({
  selectedSubjectId,
  subjects,
  onSelectSubject
}: {
  selectedSubjectId: string;
  subjects: PracticeSubjectCard[];
  onSelectSubject: (subjectId: string) => void;
}) {
  return (
    <>
      <section className="section-header practice-header-inline">
        <h3 className="text-title">Practice</h3>
        <p className="muted">Pick one focus or start with Mixed Practice.</p>
      </section>

      <section className="card practice-home-card">
        <div className="practice-subject-grid">
          {subjects.map((subject) => (
            <button
              key={subject.id}
              type="button"
              className={`practice-subject-tile ${selectedSubjectId === subject.id ? 'selected' : ''} ${subject.id === 'mixed_practice' ? 'mixed' : ''}`}
              onClick={() => onSelectSubject(subject.id)}
              style={
                {
                  '--subject-accent': subject.accent,
                  '--subject-glow': subject.glow,
                  '--subject-soft': subject.soft
                } as CSSProperties
              }
            >
              <span className="practice-subject-top">
                <span className="practice-subject-icon-wrap">
                  <span className="practice-subject-icon" aria-hidden="true">{subject.icon}</span>
                </span>
                {selectedSubjectId === subject.id && (
                  <span className="practice-subject-check" aria-hidden="true">✓</span>
                )}
              </span>
              {subject.id === 'mixed_practice' && (
                <span className="practice-subject-mixed-label">Mixed Set</span>
              )}
              <span className="practice-subject-title">{subject.title}</span>
              <span className="practice-subject-subtitle">{subject.subtitle}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function InviteEntryScreen({
  hostName,
  username,
  onJoin,
  onBackHome
}: {
  hostName: string | null;
  username: string | undefined;
  onJoin: () => void;
  onBackHome: () => void;
}) {
  return (
    <>
      <section className="section-header">
        <h2 className="text-title">Friend Challenge</h2>
        <span className="tag">Invite</span>
      </section>
      <section className="card match-lobby-card">
        <p className="match-status-title">{hostName ?? 'A friend'} challenged you!</p>
        <p className="muted">You’ll both play the same mission and compare scores. Highest score wins.</p>
        <div className="match-lobby-versus">
          <div className="match-lobby-player">
            <span className="match-lobby-player-label">Host</span>
            <strong>{hostName ?? 'Friend'}</strong>
          </div>
          <div className="match-lobby-versus-mark">vs</div>
          <div className="match-lobby-player">
            <span className="match-lobby-player-label">You</span>
            <strong>{username ?? 'Cadet'}</strong>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={onJoin}>
            Join Challenge
          </button>
          <button className="btn btn-secondary" onClick={onBackHome}>
            Back Home
          </button>
        </div>
      </section>
    </>
  );
}

export function MatchLobbyScreen({
  friendMatch,
  hostDisplayName,
  guestDisplayName,
  opponentDisplayName,
  latestInviteLink,
  matchCountdownSeconds,
  currentUserId,
  onCopyInvite,
  onViewResults,
  onBackHome
}: {
  friendMatch: FriendMatchLobbyView | null;
  hostDisplayName: string;
  guestDisplayName: string;
  opponentDisplayName: string;
  latestInviteLink: string | null;
  matchCountdownSeconds: number | null;
  currentUserId?: string;
  onCopyInvite: () => void;
  onViewResults: () => void;
  onBackHome: () => void;
}) {
  return (
    <>
      <section className="section-header">
        <h2 className="text-title">Friend Challenge</h2>
        <span className="tag">{friendMatch?.role === 'host' ? 'Host lobby' : 'Join lobby'}</span>
      </section>
      <section className="card match-lobby-card">
        {!friendMatch && <p className="muted">Preparing match lobby…</p>}
        {friendMatch && (
          <>
            <p className="muted">Same mission. Same questions. Highest score wins.</p>
            <div className="match-lobby-versus">
              <div className="match-lobby-player">
                <span className="match-lobby-player-label">Host</span>
                <strong>{hostDisplayName}</strong>
              </div>
              <div className="match-lobby-versus-mark">vs</div>
              <div className="match-lobby-player">
                <span className="match-lobby-player-label">Guest</span>
                <strong>{friendMatch.guestPlayerId ? guestDisplayName : 'Joining soon…'}</strong>
              </div>
            </div>
            <p className="muted">Match ID: <strong>{friendMatch.matchId}</strong></p>
            {friendMatch.status === 'waiting' && (
              <div className="match-status-block">
                <p className="match-status-title">Waiting for your friend…</p>
                <p className="muted">Share the invite link. Your co-pilot will appear here as soon as they join.</p>
              </div>
            )}
            {friendMatch.status === 'ready' && (
              <div className="match-status-block success">
                <p className="match-status-title">{opponentDisplayName} joined!</p>
                <p className="muted">Head-to-head mission ready. Countdown begins automatically.</p>
              </div>
            )}
            {friendMatch.status === 'started' && (
              <div className="match-status-block started">
                <p className="match-status-title">{hostDisplayName} vs {guestDisplayName}</p>
                <p className="muted">Mission starts in <strong>{matchCountdownSeconds ?? 0}</strong>…</p>
              </div>
            )}
            {friendMatch.status === 'finished' && (
              <div className="match-status-block">
                <p className="match-status-title">Match complete</p>
                <p className="muted">{friendMatch.results ? `Winner: ${friendMatch.results.winnerPlayerId === currentUserId ? 'You' : opponentDisplayName}` : 'Results ready.'}</p>
              </div>
            )}
            {latestInviteLink && friendMatch.role === 'host' && (
              <div className="invite-link-card" role="status" aria-live="polite">
                <p className="invite-link-label">Invite link ready</p>
                <div className="invite-link-row">
                  <input className="invite-link-input" value={latestInviteLink} readOnly aria-label="Challenge invite link" />
                  <button className="btn btn-secondary invite-link-copy-btn" onClick={onCopyInvite}>
                    Copy
                  </button>
                </div>
              </div>
            )}
            <div className="btn-row">
              {friendMatch.status === 'finished' && (
                <button className="btn btn-primary" onClick={onViewResults}>
                  View Results
                </button>
              )}
              <button className="btn btn-secondary" onClick={onBackHome}>
                Back Home
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export function MatchCountdownScreen({
  hostDisplayName,
  guestDisplayName,
  matchCountdownSeconds
}: {
  hostDisplayName: string;
  guestDisplayName: string;
  matchCountdownSeconds: number | null;
}) {
  return (
    <>
      <section className="section-header">
        <h2 className="text-title">Friend Challenge</h2>
        <span className="tag">Countdown</span>
      </section>
      <section className="card match-countdown-card">
        <p className="match-countdown-kicker">Head-to-head mission</p>
        <h3 className="match-countdown-title">{hostDisplayName} vs {guestDisplayName}</h3>
        <p className="muted">Same mission. Same questions. Highest score wins.</p>
        <div className="match-countdown-number">{matchCountdownSeconds ?? 0}</div>
        <p className="match-countdown-blast">Blast off soon…</p>
      </section>
    </>
  );
}

export function InvalidInviteScreen({
  message,
  onCreateNew,
  onBackHome
}: {
  message: string;
  onCreateNew: () => void;
  onBackHome: () => void;
}) {
  return (
    <>
      <section className="section-header">
        <h2 className="text-title">Invite unavailable</h2>
      </section>
      <section className="card invalid-invite-card">
        <p className="muted">{message}</p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={onCreateNew}>
            Create New Challenge
          </button>
          <button className="btn btn-secondary" onClick={onBackHome}>
            Back Home
          </button>
        </div>
      </section>
    </>
  );
}

export function FriendResultsScreen({
  title,
  opponentDisplayName,
  players,
  currentUserId,
  onRematch,
  onSoloChallenge
}: {
  title: string;
  opponentDisplayName: string;
  players: MatchResults['players'];
  currentUserId?: string;
  onRematch: () => void;
  onSoloChallenge: () => void;
}) {
  return (
    <>
      <section className="section-header">
        <h2 className="text-title">Friend Challenge Results</h2>
        <span className="tag">Head-to-head complete</span>
      </section>
      <section className="card friend-results-card">
        <p className="friend-results-title">{title}</p>
        <p className="muted friend-results-subtitle">
          {players
            .map((entry) => `${entry.playerId === currentUserId ? 'You' : opponentDisplayName}: ${entry.scoreStars}`)
            .join(' • ')}
        </p>
        <div className="summary-match-grid friend-results-grid">
          {players.map((entry) => (
            <div key={`${entry.playerId}-${entry.submittedAt}`} className="summary-match-card friend-results-player-card">
              <strong>{entry.playerId === currentUserId ? 'You' : opponentDisplayName}</strong>
              <span className="summary-match-score">{entry.scoreStars} ⭐</span>
              <small>
                {entry.correctCount}/{entry.totalCount} • {Math.round(entry.accuracy * 100)}% • {Math.round(entry.timeMs / 1000)}s
              </small>
            </div>
          ))}
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={onRematch}>Rematch</button>
          <button className="btn btn-secondary" onClick={onSoloChallenge}>Solo Challenge</button>
        </div>
      </section>
    </>
  );
}

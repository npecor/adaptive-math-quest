export type PracticeRouteStage = 'library' | 'session' | 'results';

export type AppRoute =
  | { kind: 'root' }
  | { kind: 'home' }
  | { kind: 'practice'; stage: PracticeRouteStage; subjectId?: string | null }
  | { kind: 'rankings' }
  | { kind: 'profile' }
  | { kind: 'onboarding'; next?: string | null }
  | { kind: 'solo_challenge' }
  | { kind: 'solo_results' }
  | { kind: 'invite_entry'; matchId: string; token?: string | null }
  | { kind: 'friend_challenge'; matchId: string }
  | { kind: 'friend_results'; matchId: string }
  | { kind: 'invite_invalid' }
  | { kind: 'museum' };

const isSafeNext = (value: string | null | undefined) => Boolean(value && value.startsWith('/'));

export const parseAppRoute = (href: string): AppRoute => {
  const url = new URL(href, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const next = url.searchParams.get('next');

  if (path === '/') return { kind: 'root' };
  if (path === '/home') return { kind: 'home' };
  if (path === '/rankings') return { kind: 'rankings' };
  if (path === '/profile') return { kind: 'profile' };
  if (path === '/museum') return { kind: 'museum' };
  if (path === '/onboarding') return { kind: 'onboarding', next: isSafeNext(next) ? next : null };
  if (path === '/invite/invalid') return { kind: 'invite_invalid' };
  if (path === '/challenge/solo') return { kind: 'solo_challenge' };
  if (path === '/results/solo') return { kind: 'solo_results' };

  const friendResultsMatch = path.match(/^\/challenge\/friend\/([^/]+)\/results$/i);
  if (friendResultsMatch) {
    return { kind: 'friend_results', matchId: decodeURIComponent(friendResultsMatch[1]) };
  }

  const friendMatch = path.match(/^\/challenge\/friend\/([^/]+)$/i);
  if (friendMatch) {
    return { kind: 'friend_challenge', matchId: decodeURIComponent(friendMatch[1]) };
  }

  const inviteMatch = path.match(/^\/invite\/([^/]+)$/i);
  if (inviteMatch) {
    return {
      kind: 'invite_entry',
      matchId: decodeURIComponent(inviteMatch[1]),
      token: url.searchParams.get('token')
    };
  }

  if (path === '/practice') {
    const stageParam = url.searchParams.get('stage');
    const stage: PracticeRouteStage =
      stageParam === 'session' ? 'session' : stageParam === 'results' ? 'results' : 'library';
    return {
      kind: 'practice',
      stage,
      subjectId: url.searchParams.get('subject')
    };
  }

  return { kind: 'root' };
};

export const buildAppRouteHref = (route: AppRoute): string => {
  switch (route.kind) {
    case 'root':
      return '/';
    case 'home':
      return '/home';
    case 'rankings':
      return '/rankings';
    case 'profile':
      return '/profile';
    case 'museum':
      return '/museum';
    case 'onboarding': {
      const safeNext = isSafeNext(route.next) ? route.next : null;
      const nextPart = safeNext ? `?next=${encodeURIComponent(safeNext)}` : '';
      return `/onboarding${nextPart}`;
    }
    case 'solo_challenge':
      return '/challenge/solo';
    case 'solo_results':
      return '/results/solo';
    case 'invite_invalid':
      return '/invite/invalid';
    case 'invite_entry': {
      const tokenPart = route.token ? `?token=${encodeURIComponent(route.token)}` : '';
      return `/invite/${encodeURIComponent(route.matchId)}${tokenPart}`;
    }
    case 'friend_challenge':
      return `/challenge/friend/${encodeURIComponent(route.matchId)}`;
    case 'friend_results':
      return `/challenge/friend/${encodeURIComponent(route.matchId)}/results`;
    case 'practice': {
      const params = new URLSearchParams();
      if (route.stage !== 'library') params.set('stage', route.stage);
      if (route.subjectId) params.set('subject', route.subjectId);
      const query = params.toString();
      return `/practice${query ? `?${query}` : ''}`;
    }
  }
};

export const routeNeedsUser = (route: AppRoute) =>
  route.kind === 'home' ||
  route.kind === 'practice' ||
  route.kind === 'rankings' ||
  route.kind === 'profile' ||
  route.kind === 'solo_challenge' ||
  route.kind === 'solo_results' ||
  route.kind === 'friend_challenge' ||
  route.kind === 'friend_results' ||
  route.kind === 'museum';

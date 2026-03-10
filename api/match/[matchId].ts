import { handleMatchGet, withMatchCors } from '../_lib/matches.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  withMatchCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const rawId = req.query?.matchId;
  req.query = {
    ...req.query,
    matchId: Array.isArray(rawId) ? rawId[0] : rawId
  };
  return handleMatchGet(req, res);
}

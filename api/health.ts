import { setCors } from './_lib/leaderboard.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  return res.status(200).json({ ok: true, storage: 'supabase' });
}

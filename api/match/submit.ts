import { handleMatchSubmit, withMatchCors } from '../_lib/matches.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  withMatchCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  return handleMatchSubmit(req, res);
}

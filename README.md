# Adaptive Math Quest (MVP)

React + TypeScript web app built with Vite.

## Features
- Onboarding with required username, pseudonymous handle suggestions, and avatar selection.
- 12-item runs: 8 adaptive Flow items, 3 mini-puzzles (pick 1 of 2), and optional boss puzzle.
- Elo-like hidden rating updates and adaptive item selection.
- Hint ladder with reveal behavior and point adjustments.
- Sprint + Brain + Total scoring.
- Daily streak and puzzle streak tracking.
- Local high scores and Puzzle Museum.
- Backend leaderboard API with username dedupe + score syncing.

## Seed content
- `content/flow.seed.json`
- `content/puzzles.seed.json`

## Run locally
```bash
npm install
npm run dev:full
npm test
npm run build
```

## Dev scripts
- `npm run dev:full` starts both API (`:8787`) and Vite web dev server.
- `npm run dev:api` starts only the leaderboard API.
- `npm run dev` starts only Vite (expects API already running for leaderboard features).

## Global Leaderboard (Supabase + Vercel API)

The app now supports serverless API routes backed by Supabase:
- `/api/health`
- `/api/players/register`
- `/api/scores/upsert`
- `/api/leaderboard`

### 1) Create DB table in Supabase
Run SQL from:
- `supabase/leaderboard_schema.sql`

### 2) Set Vercel environment variables
For the deployed frontend project, add:
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
- `LEADERBOARD_CORS_ORIGIN` = your frontend domain (for example `https://adaptive-math-quest-qy6c.vercel.app`)

Optional (if API is hosted on a separate domain):
- `VITE_LEADERBOARD_BASE_URL` = full API base URL

If API and frontend are in the same Vercel project, leave `VITE_LEADERBOARD_BASE_URL` empty so the app uses relative `/api/*`.

### 3) Redeploy
After env vars are set, redeploy. The leaderboard status should show:
- `🌐 Online leaderboard`
instead of local-only fallback.

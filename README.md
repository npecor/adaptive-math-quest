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

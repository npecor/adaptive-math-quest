# World Hunt (MVP)

Mobile-first hosted private scavenger hunt app.

## MVP implemented
- Lightweight session model (no auth): callsign + device session token.
- Host creates hunt, shares invite link/code, starts/ends hunt.
- Players join as individuals with callsigns.
- Photo or short clip submissions (camera roll + in-app capture entry point).
- Feed-first default experience with reactions + nominations.
- Host curation: Host Pick, Pin, Award, Add to Recap, Remove submission.
- Polling-based live updates (12s interval while live).
- Shareable recap route: `/hunt/:huntId/recap`.

## Tech stack
- Frontend: React + TypeScript + Vite
- API server: Node + Express + JSON file persistence
- Media: base64 upload API writing files to `server/uploads`

## Run locally
```bash
npm install
npm run dev:full
```

- Web app: `http://localhost:5173`
- API server: `http://localhost:8787`

`dev:full` runs:
- `npm run dev:api` (Express API)
- `npm run dev -- --host` (Vite web)

## Key endpoints
- `POST /api/hunts`
- `POST /api/hunts/:huntId/join`
- `POST /api/hunts/:huntId/start`
- `POST /api/hunts/:huntId/end`
- `GET /api/hunts/:huntId/feed`
- `POST /api/upload`
- `POST /api/submissions`
- `PATCH /api/submissions/:id/curate`
- `POST /api/submissions/:id/react`
- `POST /api/submissions/:id/nominate`
- `GET /api/hunts/:huntId/recap`

## Data files
- Hunt state JSON: `server/weekend-world-hunt-data.json`
- Uploaded media: `server/uploads/*`

## Notes
- Comments are intentionally off in MVP.
- Host and feed views rely on polling, not websockets.
- Clip max is enforced client-side + server-side (default 7 seconds).

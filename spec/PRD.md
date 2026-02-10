# Adaptive Math Quest — Mini PRD (MVP)

## Summary
Adaptive Math Quest is a GMAT-inspired adaptive math game for ages 8–11 (gifted-friendly). It ramps difficulty slowly, then hovers around the learner’s current level, sometimes above and sometimes below. It blends fast “Flow” questions with “Puzzle” content (low-floor, high-ceiling). It includes cute gamification, streaks, and local high scores. User must create a username.

## Goals
- Keep a talented 9-year-old in flow: not bored, not crushed.
- Build genuine reasoning skills via puzzles, not only arithmetic drills.
- Short sessions (2–4 minutes) with strong “one more run” loop.
- Safe defaults: local-only data storage; no online social features in MVP.

## Non-goals (MVP)
- No global leaderboard.
- No cloud sync.
- No payments/subscriptions.

---

# Core Game Loop

## Primary mode: Runs
- Each Run has 12 items:
  - 8 Flow questions (adaptive, fast)
  - 3 Mini Puzzles (user chooses 1 of 2 options each time)
  - 1 Boss Puzzle at end (optional; double Brain Score if attempted)
- Typical run: 2–4 minutes.

## Secondary mode: Puzzle Museum
- A collection view of solved puzzles (“artifacts”).
- Each puzzle shows: solved status, extensions completed, and “methods found” badges.

---

# Onboarding & Accounts

## Username (required)
- User must enter a username to proceed.
- Provide pseudonymous suggestions (e.g. CuriousComet42).
- Store locally in browser/app storage for MVP.

## Avatar / Pet
- User chooses an avatar.
- Pet companion shown in UI and evolves with mastery signals (not time/grinding).

---

# Gamification

## Two-score system
- Sprint Score: Flow questions
- Brain Score: Puzzles
- Total Score: Sprint + Brain

## Streaks
- Daily streak: played at least one run today.
- Puzzle streak: solved a puzzle without using Reveal (hints allowed).

## High Scores (local-only)
- High scores stored locally:
  - Best Total
  - Best Sprint
  - Best Brain
  - Longest Daily Streak
  - Longest Puzzle Streak

## Power-ups (MVP-lite)
- Hint button opens a hint ladder (see below).
- Second chance: allow one retry after wrong; points reduced.

---

# Content System

## Track 1 — Flow Questions
Fast questions designed for momentum and calibration.
Tags include: fractions, percents, factors, prealgebra, geometry, word problems.

## Track 2 — Puzzles
Low-floor / high-ceiling tasks with extensions.
Puzzle categories:
- patterns & rules
- counting / “how many ways”
- logic mini-grids
- balance scales (stealth algebra)
- spatial / geometry reasoning
- strategy micro-games
- proof-lite “always/sometimes/never”

### Puzzle structure
Each puzzle has:
- Core prompt/answer
- Extension 1 (deeper)
- Extension 2 (genius mode / generalization)

---

# Hint Ladder (all items)

Hints should preserve dignity; no shame. Hints are incremental:
1) Nudge (question prompt)
2) Tool (suggest table / drawing / smaller case)
3) Partial step
4) Reveal (full solution)

Scoring:
- No Reveal: full points
- Reveal: reduced points
- Hints: small or no penalty, but cap speed bonuses if hints used.

---

# Adaptive Difficulty Spec (Elo-like)

## Player rating
Each user has hidden rating R (start 1000).
Each item has difficulty Q (700–1700).

## Expected probability correct
p = 1 / (1 + 10^((Q - R) / 400))

## Rating update
After each attempt:
R = R + K * (result - p)
- result: 1 if correct, 0 if incorrect
- K: start small (10). For first 15 attempts use smaller K (6) for gentle ramp.
- Clamp delta per item to [-25, +25] to avoid spikes.

## Next-item selection policy
For each next item:
- 60%: choose target difficulty near R (Normal(R, 50))
- 25%: choose a stretch target in [R+50, R+120]
- 15%: choose an easier target in [R-120, R-50]

Smoothing:
- Max difficulty jump between consecutive Flow items: ±80.

## Puzzle adaptivity
Puzzles scale by support and depth (extensions), not only by bigger numbers:
- If puzzle solved quickly with <=1 hint, offer Extension 1.
- If Extension 1 solved quickly, offer Extension 2.
- If user struggles, offer hints earlier and/or select slightly lower-difficulty puzzle next time.

---

# Scoring

## Flow scoring (Sprint)
- Base points scale with difficulty (e.g. 10–30).
- Small speed bonus (capped).
- Streak multiplier within run (small; e.g. up to 1.25).

## Puzzle scoring (Brain)
- Core puzzle: base points (higher than Flow).
- Extensions: bonus points.
- Reveal reduces points.

---

# Screen Sketches (Text Wireframes)

## 1) Username + Avatar (required)
Title: “Choose your Space Name”
- Username input (required)
- Suggested handles chips
- Avatar picker
CTA: Begin Mission

## 2) Quick Calibration
Title: “Quick Launch Check (90 seconds)”
Text: “Just try your best — it adapts to you.”
CTA: Start

## 3) Run — Flow Item
Top bar: Pet icon + meter; Q#; Sprint Score
Card: prompt + input/choices
Buttons: Submit, Hint
Feedback: quick explanation; Next

## 4) Mini Puzzle Choice
Title: “Choose your challenge”
Two puzzle cards; user picks one.
After solve: “Try Extension?” button(s)

## 5) Boss Puzzle
Character moment: “⚡ The Fraction Fox challenges you!”
CTA: Attempt (double Brain Score) / Skip

## 6) Run Summary
Sprint Score, Brain Score, Total
Badges earned
Streak progress
Buttons: Play Again, Puzzle Museum, High Scores

## 7) High Scores
Tabs: Total / Sprint / Brain
Local-only list

## 8) Puzzle Museum
Grid of puzzle artifacts with completion state + badges

---

# Data Model (MVP)
- User { id, username, avatarId, petId, createdAt }
- Skill { userId, rating, attemptsCount, lastSeen }
- Item { id, type(flow|puzzle), difficulty, tags[], prompt, answerKey, hints[], solutionSteps[], extensions[] }
- Attempt { userId, itemId, correct, timeMs, hintsUsed, revealed, ts }
- Run { userId, totalScore, sprintScore, brainScore, dailyStreak, puzzleStreak, ts }
- HighScore { userId, mode, score, ts }

---

# MVP Acceptance Criteria
1) Username required to proceed; saved locally
2) Runs: 12 items with flow + puzzles + boss puzzle
3) Elo-like rating update and item selection works
4) Two-score system + local high scores
5) Daily streak + puzzle streak
6) Hint ladder with reveal and points adjustment
7) Seed content bank loaded from JSON files
8) Basic tests for: rating update, item selection distribution, streak logic


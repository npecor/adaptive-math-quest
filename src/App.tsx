import { useMemo, useState } from 'react';
import flowSeed from '../content/flow.seed.json';
import puzzleSeed from '../content/puzzles.seed.json';
import { selectNextFlowItem, updateRating } from './lib/adaptive';
import { defaultState, loadState, saveState } from './lib/storage';
import { updateDailyStreak, updatePuzzleStreak } from './lib/streaks';
import type { AppState, FlowItem, PuzzleItem } from './lib/types';
import './styles.css';

type Screen = 'onboarding' | 'home' | 'run' | 'summary' | 'scores' | 'museum';

interface RunState {
  phase: 'flow' | 'puzzle_pick' | 'puzzle' | 'boss';
  flowDone: number;
  puzzleDone: number;
  sprintScore: number;
  brainScore: number;
  currentFlow?: FlowItem;
  currentPuzzleChoices: PuzzleItem[];
  currentPuzzle?: PuzzleItem;
  currentHints: number;
  usedFlowIds: Set<string>;
  usedPuzzleIds: Set<string>;
  flowStreak: number;
}

const avatars = ['🐱', '🐶', '🦊', '🐼', '🐙', '🐰'];
const handles = ['CuriousComet42', 'PixelPanda77', 'OrbitOwl12', 'NovaNoodle55', 'LogicLynx31'];
const flowItems = flowSeed as FlowItem[];
const puzzleItems = puzzleSeed as PuzzleItem[];

const newRun = (): RunState => ({
  phase: 'flow',
  flowDone: 0,
  puzzleDone: 0,
  sprintScore: 0,
  brainScore: 0,
  currentPuzzleChoices: [],
  currentHints: 0,
  usedFlowIds: new Set<string>(),
  usedPuzzleIds: new Set<string>(),
  flowStreak: 0
});

const normalize = (s: string) => s.trim().toLowerCase();

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [screen, setScreen] = useState<Screen>(() => (loadState().user ? 'home' : 'onboarding'));
  const [run, setRun] = useState<RunState>(newRun());
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState('');

  const totalScore = run.sprintScore + run.brainScore;

  const save = (next: AppState) => {
    setState(next);
    saveState(next);
  };

  const startRun = () => {
    const streaks = updateDailyStreak(state.streaks);
    const seeded = newRun();
    seeded.currentFlow = selectNextFlowItem(flowItems, state.skill.rating, seeded.usedFlowIds);
    setRun(seeded);
    save({ ...state, streaks });
    setScreen('run');
    setInput('');
    setFeedback('');
  };

  const onSubmitFlow = () => {
    if (!run.currentFlow) return;
    const item = run.currentFlow;
    const answers = [item.answer, ...(item.accept_answers ?? [])].map(normalize);
    const correct = answers.includes(normalize(input));
    const updatedRating = updateRating(state.skill.rating, item.difficulty, correct, state.skill.attemptsCount);
    const hintPenalty = run.currentHints > 0 ? 0.8 : 1;
    const base = Math.round(10 + ((item.difficulty - 700) / 1000) * 20);
    const speedBonus = run.currentHints > 0 ? 0 : 3;
    const nextStreak = correct ? Math.min(run.flowStreak + 1, 5) : 0;
    const streakMult = 1 + nextStreak * 0.05;
    const gain = correct ? Math.round((base + speedBonus) * streakMult * hintPenalty) : 0;

    const nextState = {
      ...state,
      skill: { rating: updatedRating, attemptsCount: state.skill.attemptsCount + 1 }
    };
    save(nextState);

    const used = new Set(run.usedFlowIds);
    used.add(item.id);
    const nextFlowDone = run.flowDone + 1;

    if (nextFlowDone >= 8) {
      setRun({ ...run, flowDone: nextFlowDone, sprintScore: run.sprintScore + gain, usedFlowIds: used, phase: 'puzzle_pick', flowStreak: nextStreak, currentHints: 0 });
      setFeedback(correct ? 'Correct!' : `Not quite. ${item.solution_steps[0]}`);
      setInput('');
      return;
    }

    const nextItem = selectNextFlowItem(flowItems, updatedRating, used, item.difficulty);
    setRun({ ...run, flowDone: nextFlowDone, sprintScore: run.sprintScore + gain, usedFlowIds: used, currentFlow: nextItem, flowStreak: nextStreak, currentHints: 0 });
    setFeedback(correct ? 'Correct!' : `Not quite. ${item.solution_steps[0]}`);
    setInput('');
  };

  const setupPuzzlePick = () => {
    const available = puzzleItems.filter((p) => !run.usedPuzzleIds.has(p.id));
    const choices = [...available].sort(() => Math.random() - 0.5).slice(0, 2);
    setRun({ ...run, phase: 'puzzle_pick', currentPuzzleChoices: choices, currentHints: 0 });
    setInput('');
    setFeedback('');
  };

  const selectPuzzle = (p: PuzzleItem) => {
    setRun({ ...run, phase: 'puzzle', currentPuzzle: p, currentHints: 0 });
    setInput('');
  };

  const submitPuzzle = () => {
    if (!run.currentPuzzle) return;
    const correct = normalize(input) === normalize(run.currentPuzzle.core_answer);
    const revealUsed = run.currentHints >= 4;
    const base = 40;
    const hintFactor = revealUsed ? 0.35 : run.currentHints > 0 ? 0.85 : 1;
    const gain = correct ? Math.round(base * hintFactor) : 0;

    const used = new Set(run.usedPuzzleIds);
    used.add(run.currentPuzzle.id);
    const puzzleDone = run.puzzleDone + 1;

    const streaks = updatePuzzleStreak(state.streaks, correct && !revealUsed);
    const museum = [...state.museum];
    const idx = museum.findIndex((m) => m.puzzleId === run.currentPuzzle?.id);
    const entry = {
      puzzleId: run.currentPuzzle.id,
      solved: correct,
      extensionsCompleted: correct ? (run.currentHints <= 1 ? 1 : 0) : 0,
      methodsFound: correct ? ['core-solved'] : []
    };
    if (idx >= 0) museum[idx] = { ...museum[idx], ...entry };
    else museum.push(entry);

    save({ ...state, streaks, museum });

    if (puzzleDone >= 3) {
      setRun({ ...run, brainScore: run.brainScore + gain, puzzleDone, usedPuzzleIds: used, phase: 'boss', currentHints: 0 });
      setFeedback(correct ? 'Puzzle solved!' : `Try again later: ${run.currentPuzzle.solution_steps[0]}`);
      setInput('');
      return;
    }

    setRun({ ...run, brainScore: run.brainScore + gain, puzzleDone, usedPuzzleIds: used, phase: 'puzzle_pick', currentHints: 0 });
    setFeedback(correct ? 'Puzzle solved!' : `Try again later: ${run.currentPuzzle.solution_steps[0]}`);
    setInput('');
  };

  const finishRun = (bossAttempted: boolean) => {
    const brain = bossAttempted ? run.brainScore * 2 : run.brainScore;
    const total = run.sprintScore + brain;
    const highs = {
      bestTotal: Math.max(state.highs.bestTotal, total),
      bestSprint: Math.max(state.highs.bestSprint, run.sprintScore),
      bestBrain: Math.max(state.highs.bestBrain, brain)
    };
    save({ ...state, highs });
    setRun({ ...run, brainScore: brain });
    setScreen('summary');
  };

  const onboarding = (
    <div className="card">
      <h1>Choose your Space Name</h1>
      <input placeholder="Username" value={input} onChange={(e) => setInput(e.target.value)} />
      <div className="chips">{handles.map((h) => <button key={h} onClick={() => setInput(h)}>{h}</button>)}</div>
      <h3>Pick an avatar</h3>
      <div className="chips">
        {avatars.map((a) => (
          <button key={a} onClick={() => save({ ...state, user: { username: input || 'Player', avatarId: a, createdAt: new Date().toISOString() } })}>{a}</button>
        ))}
      </div>
      <button disabled={!input.trim() || !state.user?.avatarId} onClick={() => setScreen('home')}>Begin Mission</button>
    </div>
  );

  const home = (
    <div className="card">
      <h1>Adaptive Math Quest</h1>
      <p>Welcome {state.user?.avatarId} {state.user?.username}</p>
      <p>Hidden rating: {Math.round(state.skill.rating)}</p>
      <p>Daily streak: {state.streaks.dailyStreak} | Puzzle streak: {state.streaks.puzzleStreak}</p>
      <button onClick={startRun}>Start Run (12 items)</button>
      <button onClick={() => setScreen('scores')}>High Scores</button>
      <button onClick={() => setScreen('museum')}>Puzzle Museum</button>
    </div>
  );

  const runView = (
    <div className="card">
      <h2>Run in progress</h2>
      <p>Sprint: {run.sprintScore} | Brain: {run.brainScore} | Total: {totalScore}</p>
      {run.phase === 'flow' && run.currentFlow && (
        <>
          <h3>Flow {run.flowDone + 1}/8</h3>
          <p>{run.currentFlow.prompt}</p>
          {run.currentFlow.choices && run.currentFlow.choices.map((c) => <button key={c} onClick={() => setInput(c)}>{c}</button>)}
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="answer" />
          <div className="row">
            <button onClick={() => setRun({ ...run, currentHints: Math.min(run.currentHints + 1, run.currentFlow?.hints.length ?? 0) })}>Hint</button>
            <button onClick={onSubmitFlow}>Submit</button>
          </div>
          {run.currentHints > 0 && <p className="hint">Hint: {run.currentFlow.hints[Math.min(run.currentHints - 1, run.currentFlow.hints.length - 1)]}</p>}
        </>
      )}

      {run.phase === 'puzzle_pick' && (
        <>
          <h3>Choose your challenge ({run.puzzleDone + 1}/3)</h3>
          {(run.currentPuzzleChoices.length ? run.currentPuzzleChoices : puzzleItems.slice(0, 2)).map((p) => (
            <button key={p.id} onClick={() => selectPuzzle(p)}>{p.title} (d{p.difficulty})</button>
          ))}
          {!run.currentPuzzleChoices.length && <button onClick={setupPuzzlePick}>Deal puzzle cards</button>}
        </>
      )}

      {run.phase === 'puzzle' && run.currentPuzzle && (
        <>
          <h3>{run.currentPuzzle.title}</h3>
          <p>{run.currentPuzzle.core_prompt}</p>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="answer" />
          <div className="row">
            <button onClick={() => setRun({ ...run, currentHints: Math.min(run.currentHints + 1, 4) })}>Hint ladder</button>
            <button onClick={submitPuzzle}>Submit Puzzle</button>
          </div>
          {run.currentHints > 0 && <p className="hint">Hint {run.currentHints}: {run.currentPuzzle.hint_ladder[run.currentHints - 1]}</p>}
          <button onClick={setupPuzzlePick}>Skip puzzle</button>
        </>
      )}

      {run.phase === 'boss' && (
        <>
          <h3>⚡ Boss Puzzle: Fraction Fox</h3>
          <p>Attempt to double your Brain Score.</p>
          <button onClick={() => finishRun(true)}>Attempt</button>
          <button onClick={() => finishRun(false)}>Skip</button>
        </>
      )}
      {feedback && <p>{feedback}</p>}
    </div>
  );

  const summary = (
    <div className="card">
      <h2>Run Summary</h2>
      <p>Sprint Score: {run.sprintScore}</p>
      <p>Brain Score: {run.brainScore}</p>
      <p>Total Score: {run.sprintScore + run.brainScore}</p>
      <button onClick={() => setScreen('home')}>Play Again</button>
      <button onClick={() => setScreen('museum')}>Puzzle Museum</button>
      <button onClick={() => setScreen('scores')}>High Scores</button>
    </div>
  );

  const scores = (
    <div className="card">
      <h2>Local High Scores</h2>
      <p>Best Total: {state.highs.bestTotal}</p>
      <p>Best Sprint: {state.highs.bestSprint}</p>
      <p>Best Brain: {state.highs.bestBrain}</p>
      <p>Longest Daily Streak: {state.streaks.longestDailyStreak}</p>
      <p>Longest Puzzle Streak: {state.streaks.longestPuzzleStreak}</p>
      <button onClick={() => setScreen('home')}>Back</button>
    </div>
  );

  const museumRows = useMemo(() => state.museum.map((m) => {
    const puzzle = puzzleItems.find((p) => p.id === m.puzzleId);
    return { ...m, title: puzzle?.title ?? m.puzzleId };
  }), [state.museum]);

  const museum = (
    <div className="card">
      <h2>Puzzle Museum</h2>
      {museumRows.length === 0 && <p>No artifacts yet — solve puzzles in a run.</p>}
      {museumRows.map((m) => (
        <div key={m.puzzleId} className="artifact">
          <strong>{m.title}</strong> | solved: {m.solved ? 'yes' : 'no'} | extensions: {m.extensionsCompleted} | methods: {m.methodsFound.join(', ') || 'none'}
        </div>
      ))}
      <button onClick={() => setScreen('home')}>Back</button>
    </div>
  );

  if (!state.user) return onboarding;
  if (screen === 'onboarding') return onboarding;
  if (screen === 'home') return home;
  if (screen === 'run') return runView;
  if (screen === 'summary') return summary;
  if (screen === 'scores') return scores;
  return museum;
}

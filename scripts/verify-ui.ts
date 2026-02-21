import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const appPath = path.join(root, 'src', 'App.tsx');
const stylesPath = path.join(root, 'src', 'styles.css');

const app = fs.readFileSync(appPath, 'utf8');
const styles = fs.readFileSync(stylesPath, 'utf8');

const failures: string[] = [];

const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

const sectionBetween = (source: string, start: string, end: string): string => {
  const startIdx = source.indexOf(start);
  if (startIdx === -1) return '';
  const endIdx = source.indexOf(end, startIdx + start.length);
  if (endIdx === -1) return source.slice(startIdx + start.length);
  return source.slice(startIdx + start.length, endIdx);
};

const flowSection = sectionBetween(
  app,
  "{run.phase === 'flow' && run.currentFlow && (",
  "{run.phase === 'puzzle_pick' && ("
);
const puzzleSection = sectionBetween(
  app,
  "{run.phase === 'puzzle' && run.currentPuzzle && (",
  "{run.phase === 'boss' && ("
);

check(/\{flowHasChoices && \(\s*<div className="chips">/s.test(flowSection), 'Flow MC mode must render chips.');
check(/\{!flowHasChoices && \(\s*<input/s.test(flowSection), 'Flow input mode must render input only when not MC.');
check(/\{puzzleHasChoices \? \(\s*<div className="chips">/s.test(puzzleSection), 'Puzzle choice mode must render chips.');
check(/\) : puzzleInputMode === 'long_text' \? \(/.test(puzzleSection), 'Puzzle render mode split is missing.');
check(!app.includes('slice(0, run.currentHints)'), 'Hints should not stack by slicing all prior hints.');
check(
  app.includes('<button className="text-cta puzzle-tertiary-link" onClick={setupPuzzlePick}>Pick a different puzzle</button>'),
  'Pick a different puzzle must be a tertiary text link.'
);
check(!app.includes('help-circle-btn'), 'Extra help "?" entry should be removed.');
check(app.includes('run-progress-inline'), 'Run progress should use compact inline layout.');
check(!app.includes('run-progress-dock'), 'Legacy bottom run-progress dock should not render.');
check(app.includes('const shouldShowInput = !isMobileViewport || scratchpadExpanded;'), 'Scratchpad should be collapsed by default on mobile.');
check(styles.includes('.puzzle-prompt-shell'), 'Puzzle prompt shell styles are missing.');
check(/@media \(max-width: 700px\)[\s\S]*\.puzzle-prompt-shell[\s\S]*position:\s*sticky;/s.test(styles), 'Puzzle prompt should remain visible on mobile while scrolling.');
check(
  /\.puzzle-question-prompt\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;/s.test(styles),
  'Puzzle prompt needs mobile-safe wrapping to avoid truncation.'
);

if (failures.length > 0) {
  console.error('verify:ui failed');
  failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
  process.exitCode = 1;
} else {
  console.log('verify:ui passed');
  console.log('  - Render modes are split (MC vs input)');
  console.log('  - Puzzle tertiary link style is enforced');
  console.log('  - Compact progress + collapsed scratchpad checks passed');
  console.log('  - Hint stack + mobile prompt visibility checks passed');
}

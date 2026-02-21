export type FlowFormat = 'multiple_choice' | 'numeric_input' | 'text_input';

export interface FlowItem {
  id: string;
  type: 'flow';
  difficulty: number;
  tier?: 'Easy' | 'Medium' | 'Hard' | 'Expert' | 'Master';
  template: string;
  shapeSignature: string;
  tags: string[];
  difficultyBreakdown?: Record<string, number>;
  format: FlowFormat;
  prompt: string;
  answer: string;
  choices?: string[];
  accept_answers?: string[];
  unit?: string;
  hints: string[];
  solution_steps: string[];
}

export interface PuzzleExtension {
  label: string;
  prompt: string;
  answer: string;
}

export interface PuzzleItem {
  id: string;
  type: 'puzzle';
  difficulty: number;
  puzzleType?: 'constraint' | 'logic' | 'pattern' | 'word' | 'spatial';
  tags: string[];
  title: string;
  answer_type?: 'choice' | 'short_text' | 'long_text';
  core_prompt: string;
  core_answer: string;
  choices?: string[];
  accept_answers?: string[];
  extensions: PuzzleExtension[];
  hint_ladder: string[];
  solution_steps: string[];
}

export interface UserProfile {
  userId?: string;
  username: string;
  avatarId: string;
  createdAt: string;
}

export interface SkillState {
  rating: number;
  attemptsCount: number;
}

export interface StreakState {
  dailyStreak: number;
  longestDailyStreak: number;
  puzzleStreak: number;
  longestPuzzleStreak: number;
  lastPlayedDay?: string;
}

export interface HighScores {
  bestTotal: number;
  bestSprint: number;
  bestBrain: number;
}

export interface MuseumEntry {
  puzzleId: string;
  title?: string;
  solved: boolean;
  extensionsCompleted: number;
  methodsFound: string[];
}

export interface TotalsState {
  allTimeStars: number;
  bestRunStars: number;
  runsPlayed: number;
  trophiesEarned: number;
  extensionsSolved: number;
  allTimePuzzleCorrect: number;
  allTimePuzzleTries: number;
}

export interface AppState {
  user?: UserProfile;
  skill: SkillState;
  streaks: StreakState;
  highs: HighScores;
  museum: MuseumEntry[];
  totals: TotalsState;
  solvedPuzzleIds: string[];
}

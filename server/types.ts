// ============================================================
// ClickClash — Server-side Types
// Kept separate from /lib/types.ts (client) to avoid bundling
// server-only logic into the Next.js client bundle.
// ============================================================

export interface Player {
  id: string;        // socket.id (updated on reconnect)
  username: string;
  isHost: boolean;
  score: number;
  joinedAt: number;
}

export interface Category {
  id: number | null; // null = "All Categories"
  name: string;
}

/** Internal question format — correct answer IS stored server-side. */
export interface Question {
  id: string;
  text: string;
  options: string[]; // already shuffled on creation
  correct: string;
  category: string;
  difficulty: string;
}

export interface Room {
  roomCode: string;
  hostId: string;
  players: Player[];
  category: Category | null;
  status: "lobby" | "in_game" | "ended";
  currentGameId: string;
  questions: Question[];
  questionIndex: number;
  scores: Record<string, number>; // playerId -> score
  createdAt: number;
  lastActivity: number;
  inactivityTimer?: ReturnType<typeof setTimeout>;
  // Phase 4: per-question answer tracking
  answers: Map<string, { answer: string; timestamp: number }>; // socketId → answer
  questionStartTime: number;
  revealedThisQuestion: boolean;
}

// ---- Safe public shapes sent to clients ----

export interface PlayerPublic {
  id: string;
  username: string;
  isHost: boolean;
  score: number;
}

/**
 * Question payload sent to clients during a question.
 * `correct` is intentionally omitted — clients learn the answer via game:reveal.
 */
export interface QuestionPublic {
  id: string;
  text: string;
  options: string[];
  category: string;
  difficulty: string;
}

export interface RoomPublicState {
  roomCode: string;
  hostId: string;
  players: PlayerPublic[];
  category: Category | null;
  status: "lobby" | "in_game" | "ended";
  questionIndex: number;
  totalQuestions: number;
  /** Included when status === 'in_game' so reconnecting clients get current Q. */
  currentQuestion: QuestionPublic | null;
  scores: Record<string, number>;
}

// ---- Socket event payload shapes ----

export interface GameStartedPayload {
  currentGameId: string;
  totalQuestions: number;
}

export interface GameQuestionPayload {
  questionIndex: number;
  totalQuestions: number;
  question: QuestionPublic;
  scores: Record<string, number>;
}

export interface GameEndedPayload {
  scores: Record<string, number>;
  leaderboard: Array<{ id: string; username: string; score: number }>;
  winner: string | null;
}

// Phase 4 payload types

/** Broadcast when a player submits an answer (before reveal). */
export interface GamePlayerAnsweredPayload {
  count: number;  // how many players have answered
  total: number;  // total players in the game
}

/** Per-player answer record included in the reveal. */
export interface RevealPlayerEntry {
  playerId: string;
  username: string;
  selectedOption: string | null; // null if player never answered
  isCorrect: boolean;
  timeTakenSeconds: number;      // 0 if player never answered
}

/** Broadcast when all players answered (or host forces reveal). */
export interface GameRevealPayload {
  correct: string;
  /** Points earned THIS question, keyed by playerId. */
  pointsThisRound: Record<string, number>;
  /** Updated cumulative scores. */
  scores: Record<string, number>;
  /** One entry per player in the room at reveal time. */
  perPlayer: RevealPlayerEntry[];
  /** socketId of the player who clicked fastest (any answer). null if nobody answered. */
  fastestPlayerId: string | null;
  /** Human-readable highlight sentence for the fastest clicker. */
  fastestSentence: string;
}

// ============================================================
// ClickClash — Client-side Shared Types (Phase 2)
//
// These types are bundled into the browser. They mirror the
// server's public shapes but are kept separate to avoid
// importing Node.js-only server code.
// ============================================================

// ---- Phase 1 types (kept for PlayerAvatarCard compatibility) ----

/** A player slot as rendered in the UI (includes placeholder slots). */
export interface Player {
  id: string;
  username: string;
  isHost: boolean;
  /** false = empty "Waiting…" slot; true = real connected player */
  isConnected: boolean;
  /** Phase 3: driven by WebRTC audio level */
  isSpeaking?: boolean;
  score?: number;
}

// ---- Phase 2 additions ----

/** A player as returned by the server (no empty slots — all entries are real). */
export interface PlayerPublic {
  id: string;
  username: string;
  isHost: boolean;
  score: number;
}

/** Trivia category — matches both client-side list and server representation. */
export interface Category {
  id: number | null; // null = "All Categories"
  name: string;
}

/**
 * Question payload sent to clients during a question round.
 * `correct` is intentionally absent — clients receive it via game:reveal.
 */
export interface QuestionPublic {
  id: string;
  text: string;
  options: string[]; // 4 shuffled options
  category: string;
  difficulty: string;
}

/** Full room state as broadcast by the server. */
export interface RoomPublicState {
  roomCode: string;
  hostId: string;
  players: PlayerPublic[];
  category: Category | null;
  status: "lobby" | "in_game" | "ended";
  questionIndex: number;
  totalQuestions: number;
  /** Non-null while status === 'in_game'; includes current question. */
  currentQuestion: QuestionPublic | null;
  scores: Record<string, number>;
}

/** Payload of a game:question socket event. */
export interface GameQuestionPayload {
  questionIndex: number;
  totalQuestions: number;
  question: QuestionPublic;
  scores: Record<string, number>;
}

/** Payload of the game:ended socket event. */
export interface GameEndedPayload {
  scores: Record<string, number>;
  leaderboard: Array<{ id: string; username: string; score: number }>;
  winner: string | null;
}

// Phase 4 payloads

/** Broadcast each time a player answers — for the "X/Y answered" progress UI. */
export interface GamePlayerAnsweredPayload {
  count: number;
  total: number;
}

/** Per-player answer record included in the reveal. */
export interface RevealPlayerEntry {
  playerId: string;
  username: string;
  selectedOption: string | null; // null if player never answered
  isCorrect: boolean;
  timeTakenSeconds: number;      // 0 if player never answered
}

/** Broadcast when all players answer (or host forces reveal). */
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

// ---- UI-only types (unchanged from Phase 1) ----

export interface FormState {
  username: string;
  roomCode: string;
  errors: { username?: string; roomCode?: string };
  isLoading: boolean;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

// ---- Helper: convert PlayerPublic[] to Player[] (fills to 4 slots) ----

/**
 * Takes the server's real player list and pads it to `maxSlots` with
 * "Waiting…" placeholder entries so the UI always shows 4 slots.
 */
export function toDisplayPlayers(
  serverPlayers: PlayerPublic[],
  maxSlots = 4
): Player[] {
  const connected: Player[] = serverPlayers.map((p) => ({
    id: p.id,
    username: p.username,
    isHost: p.isHost,
    isConnected: true,
    score: p.score,
  }));

  const placeholderCount = Math.max(0, maxSlots - connected.length);
  const placeholders: Player[] = Array.from(
    { length: placeholderCount },
    (_, i) => ({
      id: `waiting-${i}`,
      username: "Waiting…",
      isHost: false,
      isConnected: false,
    })
  );

  return [...connected, ...placeholders];
}

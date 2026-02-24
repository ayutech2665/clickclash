// ============================================================
// ClickClash — Room Manager
//
// Manages all in-memory rooms. No database — rooms live only
// as long as the process is running (acceptable for Phase 2).
//
// Key design decisions:
// - Reconnect detection: if a player joins with an existing username
//   in the same room, we treat it as a reconnect and update socket.id.
// - Host transfer: if host disconnects, the next player in the array
//   automatically becomes host.
// - Inactivity timeout: rooms self-destruct after INACTIVITY_TIMEOUT_MS
//   of no activity to prevent memory leaks.
// ============================================================

import { fetchQuestions } from "./trivia";
import type {
  Room,
  Player,
  Category,
  Question,
  PlayerPublic,
  QuestionPublic,
  RoomPublicState,
  GameRevealPayload,
  RevealPlayerEntry,
} from "./types";

const MAX_PLAYERS = 4;
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

// ---- ID generators ----

function generateRoomCode(): string {
  // Omit 0/O/1/I to avoid visual confusion
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateGameId(): string {
  return `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Public state helpers ----

function toPlayerPublic(p: Player): PlayerPublic {
  return { id: p.id, username: p.username, isHost: p.isHost, score: p.score };
}

function toQuestionPublic(q: Question): QuestionPublic {
  // `correct` is intentionally omitted — sent only via game:reveal
  return {
    id: q.id,
    text: q.text,
    options: q.options,
    category: q.category,
    difficulty: q.difficulty,
  };
}

export function toRoomPublicState(room: Room): RoomPublicState {
  const currentQuestion =
    room.status === "in_game" && room.questions.length > 0
      ? toQuestionPublic(room.questions[room.questionIndex])
      : null;

  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    players: room.players.map(toPlayerPublic),
    category: room.category,
    status: room.status,
    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length,
    currentQuestion,
    scores: { ...room.scores },
  };
}

// ============================================================
// RoomManager class
// ============================================================

export class RoomManager {
  /** roomCode → Room */
  private rooms = new Map<string, Room>();

  /** socketId → roomCode (for fast disconnect lookup) */
  private socketRooms = new Map<string, string>();

  // ---- create ----

  createRoom(socketId: string, username: string): Room {
    const roomCode = this.uniqueRoomCode();

    const player: Player = {
      id: socketId,
      username,
      isHost: true,
      score: 0,
      joinedAt: Date.now(),
    };

    const room: Room = {
      roomCode,
      hostId: socketId,
      players: [player],
      category: null,
      status: "lobby",
      currentGameId: "",
      questions: [],
      questionIndex: 0,
      scores: {},
      createdAt: Date.now(),
      lastActivity: Date.now(),
      // Phase 4: per-question tracking (initialised properly on game start)
      answers: new Map(),
      questionStartTime: 0,
      revealedThisQuestion: false,
    };

    this.rooms.set(roomCode, room);
    this.socketRooms.set(socketId, roomCode);
    this.resetInactivityTimer(room);
    return room;
  }

  // ---- join (also handles reconnect) ----

  joinRoom(socketId: string, roomCode: string, username: string): Room {
    const upper = roomCode.toUpperCase();
    const room = this.rooms.get(upper);
    if (!room) throw new Error("Room not found. Check the code and try again.");

    if (room.status === "ended") {
      throw new Error("This game has already ended. Ask the host to start a new one.");
    }

    // --- Reconnect path: same username already in room ---
    const existing = room.players.find(
      (p) => p.username.toLowerCase() === username.toLowerCase()
    );
    if (existing) {
      const oldId = existing.id;
      existing.id = socketId;
      if (existing.isHost) room.hostId = socketId;
      this.socketRooms.delete(oldId);
      this.socketRooms.set(socketId, upper);
      room.lastActivity = Date.now();
      this.resetInactivityTimer(room);
      return room;
    }

    // --- New player path ---
    if (room.players.length >= MAX_PLAYERS) {
      throw new Error("This room is full (max 4 players).");
    }
    if (room.status === "in_game") {
      throw new Error("A game is already in progress. You can join the next round.");
    }

    const player: Player = {
      id: socketId,
      username,
      isHost: false,
      score: 0,
      joinedAt: Date.now(),
    };

    room.players.push(player);
    this.socketRooms.set(socketId, upper);
    room.lastActivity = Date.now();
    this.resetInactivityTimer(room);
    return room;
  }

  // ---- leave ----

  /**
   * Remove a player from their room.
   * Returns the updated room (with remaining players) or null if the room
   * was destroyed because it became empty.
   */
  leaveRoom(socketId: string): Room | null {
    const roomCode = this.socketRooms.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.socketRooms.delete(socketId);
      return null;
    }

    room.players = room.players.filter((p) => p.id !== socketId);
    this.socketRooms.delete(socketId);

    // Room is now empty — destroy it
    if (room.players.length === 0) {
      this.destroyRoom(room);
      return null;
    }

    // Host left — transfer to next player (join order)
    if (room.hostId === socketId) {
      const newHost = room.players[0];
      newHost.isHost = true;
      room.hostId = newHost.id;
    }

    room.lastActivity = Date.now();
    return room;
  }

  // ---- category ----

  setCategory(
    socketId: string,
    roomCode: string,
    categoryId: number | null,
    categoryName: string
  ): Room {
    const room = this.requireHostRoom(socketId, roomCode);
    room.category = { id: categoryId, name: categoryName };
    room.lastActivity = Date.now();
    return room;
  }

  // ---- game:start ----

  async startGame(socketId: string, roomCode: string): Promise<Room> {
    const room = this.requireHostRoom(socketId, roomCode);

    if (room.status !== "lobby") {
      throw new Error("Can only start from lobby state.");
    }
    if (room.players.length < 2) {
      throw new Error("Need at least 2 players to start the quiz.");
    }

    const gameId = generateGameId();
    const questions = await fetchQuestions(room.category?.id ?? null, gameId);

    room.currentGameId = gameId;
    room.questions = questions;
    room.questionIndex = 0;
    room.status = "in_game";

    // Reset all scores
    room.scores = {};
    room.players.forEach((p) => {
      p.score = 0;
      room.scores[p.id] = 0;
    });

    // Phase 4: init per-question tracking
    room.answers = new Map();
    room.questionStartTime = Date.now();
    room.revealedThisQuestion = false;

    room.lastActivity = Date.now();
    return room;
  }

  // ---- game:next ----

  nextQuestion(
    socketId: string,
    roomCode: string
  ): { room: Room; question: Question | null; isEnd: boolean } {
    const room = this.requireHostRoom(socketId, roomCode);

    if (room.status !== "in_game") {
      throw new Error("No game in progress.");
    }

    room.questionIndex++;
    room.lastActivity = Date.now();

    if (room.questionIndex >= room.questions.length) {
      room.status = "ended";
      return { room, question: null, isEnd: true };
    }

    // Phase 4: reset per-question tracking for the new question
    room.answers = new Map();
    room.questionStartTime = Date.now();
    room.revealedThisQuestion = false;

    return {
      room,
      question: room.questions[room.questionIndex],
      isEnd: false,
    };
  }

  // ---- game:new ----

  async newGame(socketId: string, roomCode: string): Promise<Room> {
    const room = this.requireHostRoom(socketId, roomCode);

    // Allow restarting from ended state or even in_game (edge case)
    const gameId = generateGameId();
    const questions = await fetchQuestions(room.category?.id ?? null, gameId);

    room.currentGameId = gameId;
    room.questions = questions;
    room.questionIndex = 0;
    room.status = "in_game";

    room.scores = {};
    room.players.forEach((p) => {
      p.score = 0;
      room.scores[p.id] = 0;
    });

    // Phase 4: reset per-question tracking
    room.answers = new Map();
    room.questionStartTime = Date.now();
    room.revealedThisQuestion = false;

    room.lastActivity = Date.now();
    return room;
  }

  // ---- game:answer ----

  /**
   * Record a player's answer for the current question.
   * Returns answer count info; `allAnswered` signals that game:reveal should fire.
   */
  recordAnswer(
    socketId: string,
    roomCode: string,
    questionId: string,
    answer: string
  ): {
    alreadyAnswered: boolean;
    wrongQuestion: boolean;
    allAnswered: boolean;
    answeredCount: number;
    totalCount: number;
  } {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("Room not found.");
    if (room.status !== "in_game") throw new Error("No game in progress.");

    const currentQuestion = room.questions[room.questionIndex];
    if (currentQuestion.id !== questionId) {
      return { alreadyAnswered: false, wrongQuestion: true, allAnswered: false, answeredCount: 0, totalCount: 0 };
    }

    if (room.answers.has(socketId)) {
      return {
        alreadyAnswered: true,
        wrongQuestion: false,
        allAnswered: false,
        answeredCount: room.answers.size,
        totalCount: room.players.length,
      };
    }

    room.answers.set(socketId, { answer, timestamp: Date.now() });
    room.lastActivity = Date.now();

    const allAnswered = room.answers.size >= room.players.length;
    return {
      alreadyAnswered: false,
      wrongQuestion: false,
      allAnswered,
      answeredCount: room.answers.size,
      totalCount: room.players.length,
    };
  }

  // ---- game:reveal ----

  /**
   * Calculate points for the current question, update scores, mark revealed.
   * Points by correct-answer rank: 1st=1000, 2nd=800, 3rd=600, 4th=400; wrong=0.
   * Also computes per-player timing, fastest clicker, and reveal sentence.
   */
  buildRevealPayload(roomCode: string): GameRevealPayload {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("Room not found.");

    const currentQuestion = room.questions[room.questionIndex];
    const correct = currentQuestion.correct;

    // Sort answers by timestamp — fastest first (determines point tiers)
    const POINT_TIERS = [1000, 800, 600, 400];
    const sortedAnswers = [...room.answers.entries()].sort(
      ([, a], [, b]) => a.timestamp - b.timestamp
    );

    const pointsThisRound: Record<string, number> = {};
    let correctRank = 0;

    for (const [playerId, { answer }] of sortedAnswers) {
      if (answer === correct) {
        pointsThisRound[playerId] = POINT_TIERS[correctRank] ?? POINT_TIERS[POINT_TIERS.length - 1];
        correctRank++;
      } else {
        pointsThisRound[playerId] = 0;
      }
    }

    // Players who didn't answer at all score 0
    for (const player of room.players) {
      if (!(player.id in pointsThisRound)) {
        pointsThisRound[player.id] = 0;
      }
    }

    // Apply points to cumulative scores
    for (const [playerId, pts] of Object.entries(pointsThisRound)) {
      room.scores[playerId] = (room.scores[playerId] ?? 0) + pts;
      const player = room.players.find((p) => p.id === playerId);
      if (player) player.score = room.scores[playerId];
    }

    // Build per-player reveal entries (sorted: answered first by speed, then unanswered)
    const perPlayer: RevealPlayerEntry[] = [];
    const answeredIds = new Set(room.answers.keys());

    // Answered players (already sorted by timestamp in sortedAnswers)
    for (const [playerId, { answer, timestamp }] of sortedAnswers) {
      const player = room.players.find((p) => p.id === playerId);
      if (!player) continue;
      const timeTakenMs = timestamp - room.questionStartTime;
      perPlayer.push({
        playerId,
        username: player.username,
        selectedOption: answer,
        isCorrect: answer === correct,
        timeTakenSeconds: parseFloat((timeTakenMs / 1000).toFixed(2)),
      });
    }

    // Players who did not answer
    for (const player of room.players) {
      if (!answeredIds.has(player.id)) {
        perPlayer.push({
          playerId: player.id,
          username: player.username,
          selectedOption: null,
          isCorrect: false,
          timeTakenSeconds: 0,
        });
      }
    }

    // Fastest clicker (smallest timestamp, regardless of correctness)
    const fastestEntry = sortedAnswers[0];
    const fastestPlayerId = fastestEntry ? fastestEntry[0] : null;
    const fastestPlayer = fastestPlayerId
      ? room.players.find((p) => p.id === fastestPlayerId)
      : null;
    const fastestSec = fastestEntry
      ? parseFloat(((fastestEntry[1].timestamp - room.questionStartTime) / 1000).toFixed(2))
      : 0;

    const FASTEST_TEMPLATES = [
      (n: string, s: number) => `⚡ Lightning Fingers: ${n} snapped this in ${s}s!`,
      (n: string, s: number) => `🏁 Photo-finish: ${n} answered in ${s}s!`,
      (n: string, s: number) => `🚀 Speed demon: ${n} clicked it in ${s}s!`,
      (n: string, s: number) => `🎯 Quickdraw: ${n} locked in at ${s}s!`,
    ];
    const templateIndex = room.questionIndex % FASTEST_TEMPLATES.length;
    const fastestSentence =
      fastestPlayer && fastestEntry
        ? FASTEST_TEMPLATES[templateIndex](fastestPlayer.username, fastestSec)
        : "";

    room.revealedThisQuestion = true;

    return {
      correct,
      pointsThisRound,
      scores: { ...room.scores },
      perPlayer,
      fastestPlayerId,
      fastestSentence,
    };
  }

  // ---- getters ----

  getRoom(roomCode: string): Room | null {
    return this.rooms.get(roomCode.toUpperCase()) ?? null;
  }

  getPlayerRoom(socketId: string): string | null {
    return this.socketRooms.get(socketId) ?? null;
  }

  /** Returns all active room codes — used for diagnostics/logging. */
  listRoomCodes(): string[] {
    return Array.from(this.rooms.keys());
  }

  // ---- private helpers ----

  private requireHostRoom(socketId: string, roomCode: string): Room {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== socketId) throw new Error("Only the host can do this.");
    return room;
  }

  private uniqueRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Could not generate a unique room code. Try again.");
  }

  private destroyRoom(room: Room): void {
    if (room.inactivityTimer) clearTimeout(room.inactivityTimer);
    this.rooms.delete(room.roomCode);
    console.log(`[room] destroyed: ${room.roomCode}`);
  }

  private resetInactivityTimer(room: Room): void {
    if (room.inactivityTimer) clearTimeout(room.inactivityTimer);
    room.inactivityTimer = setTimeout(() => {
      console.log(`[room] inactivity timeout: ${room.roomCode}`);
      this.destroyRoom(room);
    }, INACTIVITY_TIMEOUT_MS);
  }
}

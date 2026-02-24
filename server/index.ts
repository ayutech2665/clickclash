// ============================================================
// ClickClash — Socket.IO Server (Express + Socket.IO)
//
// Runs independently of Next.js on port 3001 (configurable via
// SOCKET_PORT env var). The Next.js app connects to this server
// via the NEXT_PUBLIC_SOCKET_URL env var.
//
// Start alongside Next.js using: npm run dev
// ============================================================

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { RoomManager, toRoomPublicState } from "./roomManager";
import { VoiceManager } from "./voiceManager";
import type { QuestionPublic } from "./types";

const app = express();
const httpServer = createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
});

const roomManager = new RoomManager();
const voiceManager = new VoiceManager();

// ---- HTTP health check ----
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ---- Helper: build the question payload sent to all clients ----
function questionPayload(room: ReturnType<typeof roomManager.getRoom>) {
  if (!room) return null;
  const q = room.questions[room.questionIndex];
  // `correct` is intentionally omitted — sent only via game:reveal
  const question: QuestionPublic = {
    id: q.id,
    text: q.text,
    options: q.options,
    category: q.category,
    difficulty: q.difficulty,
  };
  return {
    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length,
    question,
    scores: { ...room.scores },
  };
}

// ============================================================
// Socket.IO event handlers
// ============================================================

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // ----------------------------------------------------------
  // room:create
  // ----------------------------------------------------------
  socket.on(
    "room:create",
    ({ username }: { username: string }, ack: (res: object) => void) => {
      try {
        const room = roomManager.createRoom(socket.id, username);
        socket.join(room.roomCode);
        console.log(`[room] created: ${room.roomCode} by "${username}"`);
        ack({ success: true, roomCode: room.roomCode, playerId: socket.id, hostId: room.hostId });
      } catch (err) {
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // room:join  (also used for reconnect — server detects by username match)
  // ----------------------------------------------------------
  socket.on(
    "room:join",
    (
      { roomCode, username, traceId }: { roomCode: string; username: string; traceId?: string },
      ack: (res: object) => void
    ) => {
      try {
        const room = roomManager.joinRoom(socket.id, roomCode, username);
        socket.join(room.roomCode);
        const state = toRoomPublicState(room);
        socket.to(room.roomCode).emit("room:updated", state);
        console.log(`[room:join] "${username}" joined/reconnected: ${room.roomCode}`, { traceId });
        ack({ success: true, roomCode: room.roomCode, playerId: socket.id, hostId: room.hostId, state });
      } catch (err) {
        const msg = (err as Error).message;
        console.warn("[room:not_found]", {
          event: "room:join",
          roomCode,
          username,
          fromSocket: socket.id,
          traceId,
          error: msg,
          activeRooms: roomManager.listRoomCodes(),
        });
        ack({ success: false, error: msg });
      }
    }
  );

  // ----------------------------------------------------------
  // room:state:get  — snapshot for reconnecting clients
  // ----------------------------------------------------------
  socket.on(
    "room:state:get",
    ({ roomCode, traceId }: { roomCode: string; traceId?: string }, ack: (res: object) => void) => {
      try {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
          console.warn("[room:not_found]", {
            event: "room:state:get",
            roomCode,
            fromSocket: socket.id,
            traceId,
            activeRooms: roomManager.listRoomCodes(),
          });
          ack({ success: false, error: "Room not found." });
          return;
        }
        ack({ success: true, state: toRoomPublicState(room) });
      } catch (err) {
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // room:category:set  — host only
  // ----------------------------------------------------------
  socket.on(
    "room:category:set",
    (
      { roomCode, categoryId, categoryName }: { roomCode: string; categoryId: number | null; categoryName: string },
      ack: (res: object) => void
    ) => {
      try {
        const room = roomManager.setCategory(socket.id, roomCode, categoryId, categoryName);
        io.to(room.roomCode).emit("room:updated", toRoomPublicState(room));
        ack({ success: true });
      } catch (err) {
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // game:start  — host only; fetches questions from OpenTDB
  // ----------------------------------------------------------
  socket.on(
    "game:start",
    async ({ roomCode }: { roomCode: string }, ack: (res: object) => void) => {
      try {
        const room = await roomManager.startGame(socket.id, roomCode);

        // 1) Announce game started (triggers client-side navigation to /play)
        io.to(room.roomCode).emit("game:started", {
          currentGameId: room.currentGameId,
          totalQuestions: room.questions.length,
        });

        // 2) Send first question immediately
        const payload = questionPayload(room)!;
        io.to(room.roomCode).emit("game:question", payload);

        // 3) Sync room state
        io.to(room.roomCode).emit("room:updated", toRoomPublicState(room));

        console.log(`[game] started: ${room.roomCode} (${room.questions.length} Qs)`);
        ack({ success: true });
      } catch (err) {
        console.error(`[game:start] error:`, err);
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // game:answer  — player submits their answer
  // ----------------------------------------------------------
  socket.on(
    "game:answer",
    (
      { roomCode, questionId, answer }: { roomCode: string; questionId: string; answer: string },
      ack: (res: object) => void
    ) => {
      try {
        const result = roomManager.recordAnswer(socket.id, roomCode, questionId, answer);

        if (result.wrongQuestion) {
          ack({ success: false, error: "Answer for wrong question — already advanced?" });
          return;
        }
        if (result.alreadyAnswered) {
          ack({ success: false, error: "Already answered." });
          return;
        }

        ack({ success: true });

        // Broadcast progress to all players in the room
        io.to(roomCode.toUpperCase()).emit("game:player-answered", {
          count: result.answeredCount,
          total: result.totalCount,
        });

        // Auto-reveal when every player has answered
        if (result.allAnswered) {
          const room = roomManager.getRoom(roomCode)!;
          const revealPayload = roomManager.buildRevealPayload(roomCode);
          io.to(roomCode.toUpperCase()).emit("game:reveal", revealPayload);
          io.to(roomCode.toUpperCase()).emit("room:updated", toRoomPublicState(room));
          console.log(`[game] auto-reveal: ${roomCode} (all ${result.totalCount} answered)`);
        }
      } catch (err) {
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // game:force-reveal  — host forces reveal before all have answered
  // ----------------------------------------------------------
  socket.on(
    "game:force-reveal",
    ({ roomCode }: { roomCode: string }, ack: (res: object) => void) => {
      try {
        const room = roomManager.getRoom(roomCode);
        if (!room) throw new Error("Room not found.");
        if (room.hostId !== socket.id) throw new Error("Only the host can force a reveal.");
        if (room.revealedThisQuestion) {
          ack({ success: true }); // idempotent
          return;
        }
        const revealPayload = roomManager.buildRevealPayload(roomCode);
        io.to(roomCode.toUpperCase()).emit("game:reveal", revealPayload);
        io.to(roomCode.toUpperCase()).emit("room:updated", toRoomPublicState(room));
        console.log(`[game] force-reveal: ${roomCode}`);
        ack({ success: true });
      } catch (err) {
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // game:next  — host advances to next question (requires reveal first)
  // ----------------------------------------------------------
  socket.on(
    "game:next",
    ({ roomCode }: { roomCode: string }, ack: (res: object) => void) => {
      try {
        const currentRoom = roomManager.getRoom(roomCode);
        if (!currentRoom) throw new Error("Room not found.");
        if (!currentRoom.revealedThisQuestion) {
          ack({ success: false, error: "Reveal answers first before advancing." });
          return;
        }

        const result = roomManager.nextQuestion(socket.id, roomCode);

        if (result.isEnd) {
          // Build sorted leaderboard
          const leaderboard = [...result.room.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => ({ id: p.id, username: p.username, score: p.score }));

          io.to(roomCode.toUpperCase()).emit("game:ended", {
            scores: result.room.scores,
            leaderboard,
            winner: leaderboard[0]?.username ?? null,
          });
          io.to(roomCode.toUpperCase()).emit("room:updated", toRoomPublicState(result.room));
          console.log(`[game] ended: ${roomCode}`);
        } else {
          const payload = questionPayload(result.room)!;
          io.to(roomCode.toUpperCase()).emit("game:question", payload);
          io.to(roomCode.toUpperCase()).emit("room:updated", toRoomPublicState(result.room));
        }

        ack({ success: true });
      } catch (err) {
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // game:new  — host starts a fresh game with new questions
  // ----------------------------------------------------------
  socket.on(
    "game:new",
    async ({ roomCode }: { roomCode: string }, ack: (res: object) => void) => {
      try {
        const room = await roomManager.newGame(socket.id, roomCode);

        io.to(room.roomCode).emit("game:started", {
          currentGameId: room.currentGameId,
          totalQuestions: room.questions.length,
        });

        const payload = questionPayload(room)!;
        io.to(room.roomCode).emit("game:question", payload);
        io.to(room.roomCode).emit("room:updated", toRoomPublicState(room));

        console.log(`[game] new game: ${room.roomCode}`);
        ack({ success: true });
      } catch (err) {
        console.error(`[game:new] error:`, err);
        ack({ success: false, error: (err as Error).message });
      }
    }
  );

  // ----------------------------------------------------------
  // voice:ice-config:get  — return ICE server list (STUN + optional TURN)
  // TURN credentials are read from env vars and never exposed to the client
  // in plaintext JS — they're served on-demand to authenticated sockets only.
  // ----------------------------------------------------------
  socket.on("voice:ice-config:get", (ack: (res: object) => void) => {
    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];

    const turnUrls     = process.env.TURN_URLS?.trim();
    const turnUsername = process.env.TURN_USERNAME?.trim();
    const turnPassword = process.env.TURN_PASSWORD?.trim();

    if (turnUrls && turnUsername && turnPassword) {
      iceServers.push({
        urls: turnUrls.split(",").map((u) => u.trim()),
        username: turnUsername,
        credential: turnPassword,
      });
    }

    ack({ success: true, iceServers });
  });

  // ----------------------------------------------------------
  // voice:join  — join the voice room; returns existing voice peers
  // ----------------------------------------------------------
  socket.on(
    "voice:join",
    (
      { roomCode, username, traceId }: { roomCode: string; username: string; traceId?: string },
      ack: (res: object) => void
    ) => {
      // Guard: room must still exist in roomManager (server restart wipes rooms)
      if (!roomManager.getRoom(roomCode)) {
        console.warn("[room:not_found]", {
          event: "voice:join",
          roomCode,
          username,
          fromSocket: socket.id,
          traceId,
          activeRooms: roomManager.listRoomCodes(),
        });
        ack({ success: false, error: "Room not found. The session may have expired." });
        return;
      }
      const peers = voiceManager.join(roomCode, socket.id, username);
      socket.to(roomCode).emit("voice:peer-joined", { socketId: socket.id, username });
      console.log(`[voice] "${username}" joined voice: ${roomCode}`, { traceId, existingPeers: peers.length });
      ack({ success: true, peers });
    }
  );

  // ----------------------------------------------------------
  // voice:leave  — leave the voice room
  // ----------------------------------------------------------
  socket.on(
    "voice:leave",
    ({ roomCode }: { roomCode: string }, ack: (res: object) => void) => {
      voiceManager.leave(roomCode, socket.id);
      socket.to(roomCode).emit("voice:peer-left", { socketId: socket.id });
      console.log(`[voice] ${socket.id} left voice: ${roomCode}`);
      ack({ success: true });
    }
  );

  // ----------------------------------------------------------
  // voice:offer  — relay WebRTC offer to a specific peer
  // ----------------------------------------------------------
  socket.on(
    "voice:offer",
    (
      {
        toSocketId,
        offer,
      }: { roomCode: string; toSocketId: string; offer: RTCSessionDescriptionInit },
      ack: (res: object) => void
    ) => {
      io.to(toSocketId).emit("voice:offer", { fromSocketId: socket.id, offer });
      ack({ success: true });
    }
  );

  // ----------------------------------------------------------
  // voice:answer  — relay WebRTC answer to a specific peer
  // ----------------------------------------------------------
  socket.on(
    "voice:answer",
    (
      {
        toSocketId,
        answer,
      }: { roomCode: string; toSocketId: string; answer: RTCSessionDescriptionInit },
      ack: (res: object) => void
    ) => {
      io.to(toSocketId).emit("voice:answer", { fromSocketId: socket.id, answer });
      ack({ success: true });
    }
  );

  // ----------------------------------------------------------
  // voice:ice  — relay ICE candidate to a specific peer
  // ----------------------------------------------------------
  socket.on(
    "voice:ice",
    (
      {
        toSocketId,
        candidate,
      }: { roomCode: string; toSocketId: string; candidate: RTCIceCandidateInit },
      ack: (res: object) => void
    ) => {
      io.to(toSocketId).emit("voice:ice", { fromSocketId: socket.id, candidate });
      ack({ success: true });
    }
  );

  // ----------------------------------------------------------
  // debug:rooms  — dev-only; returns active room codes for diagnostics
  // ----------------------------------------------------------
  socket.on("debug:rooms", (ack: (res: object) => void) => {
    ack({
      rooms: roomManager.listRoomCodes(),
      voiceRooms: voiceManager.listRoomCodes(),
      socketId: socket.id,
    });
  });

  // ----------------------------------------------------------
  // disconnect
  // ----------------------------------------------------------
  socket.on("disconnect", (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);

    // Voice cleanup: remove from any voice rooms and notify peers
    const voiceRooms = voiceManager.leaveAll(socket.id);
    for (const rc of voiceRooms) {
      io.to(rc).emit("voice:peer-left", { socketId: socket.id });
    }

    // Room cleanup
    const roomCode = roomManager.getPlayerRoom(socket.id);
    if (!roomCode) return;

    const updatedRoom = roomManager.leaveRoom(socket.id);
    if (updatedRoom) {
      io.to(roomCode).emit("room:updated", toRoomPublicState(updatedRoom));
      console.log(`[room] player left ${roomCode}, ${updatedRoom.players.length} remain`);
    }
  });
});

// ---- Start ----
httpServer.listen(PORT, () => {
  console.log(`[server] ClickClash Socket.IO running on http://localhost:${PORT}`);
  console.log(`[server] CORS origin: ${CORS_ORIGIN}`);
});

// ============================================================
// ClickClash — Socket.IO Client Singleton
//
// A single socket instance is created lazily and reused across
// page navigations (Next.js App Router keeps the module alive).
//
// Usage:
//   const socket = await ensureConnected();
//   socket.emit("room:create", { username }, (res) => { ... });
// ============================================================

import { io, type Socket } from "socket.io-client";
import type {
  RoomPublicState,
  QuestionPublic,
  GameQuestionPayload,
  GameEndedPayload,
  GamePlayerAnsweredPayload,
  GameRevealPayload,
  RevealPlayerEntry,
} from "./types";

// Re-export so pages can import from one place
export type { RevealPlayerEntry };

// ---- Typed Socket event interfaces ----

export interface ServerToClientEvents {
  "room:updated": (state: RoomPublicState) => void;
  "game:started": (data: { currentGameId: string; totalQuestions: number }) => void;
  "game:question": (data: GameQuestionPayload) => void;
  "game:ended": (data: GameEndedPayload) => void;
  // Phase 4: click-race scoring
  "game:player-answered": (data: GamePlayerAnsweredPayload) => void;
  "game:reveal": (data: GameRevealPayload) => void;
  error: (data: { message: string }) => void;
  // Phase 3: WebRTC voice signaling
  "voice:peer-joined": (data: { socketId: string; username: string }) => void;
  "voice:peer-left": (data: { socketId: string }) => void;
  "voice:offer": (data: { fromSocketId: string; offer: RTCSessionDescriptionInit }) => void;
  "voice:answer": (data: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => void;
  "voice:ice": (data: { fromSocketId: string; candidate: RTCIceCandidateInit }) => void;
}

export type AckResponse<T = Record<string, never>> =
  | ({ success: true } & T)
  | { success: false; error: string };

export interface ClientToServerEvents {
  "room:create": (
    data: { username: string },
    ack: AckCallback<{ roomCode: string; playerId: string; hostId: string }>
  ) => void;
  "room:join": (
    data: { roomCode: string; username: string; traceId?: string },
    ack: AckCallback<{ roomCode: string; playerId: string; hostId: string; state: RoomPublicState }>
  ) => void;
  "room:state:get": (
    data: { roomCode: string },
    ack: AckCallback<{ state: RoomPublicState }>
  ) => void;
  "room:category:set": (
    data: { roomCode: string; categoryId: number | null; categoryName: string },
    ack: AckCallback
  ) => void;
  "game:start": (data: { roomCode: string }, ack: AckCallback) => void;
  "game:next": (data: { roomCode: string }, ack: AckCallback) => void;
  "game:new": (data: { roomCode: string }, ack: AckCallback) => void;
  // Phase 4: click-race scoring
  "game:answer": (
    data: { roomCode: string; questionId: string; answer: string },
    ack: AckCallback
  ) => void;
  "game:force-reveal": (data: { roomCode: string }, ack: AckCallback) => void;
  // Phase 3: WebRTC voice signaling
  "voice:join": (
    data: { roomCode: string; username: string },
    ack: AckCallback<{ peers: Array<{ socketId: string; username: string }> }>
  ) => void;
  "voice:leave": (data: { roomCode: string }, ack: AckCallback) => void;
  /** Phase 6: fetch ICE server list (STUN + optional TURN) from the server. */
  "voice:ice-config:get": (
    ack: AckCallback<{ iceServers: RTCIceServer[] }>
  ) => void;
  "voice:offer": (
    data: { roomCode: string; toSocketId: string; offer: RTCSessionDescriptionInit },
    ack: AckCallback
  ) => void;
  "voice:answer": (
    data: { roomCode: string; toSocketId: string; answer: RTCSessionDescriptionInit },
    ack: AckCallback
  ) => void;
  "voice:ice": (
    data: { roomCode: string; toSocketId: string; candidate: RTCIceCandidateInit },
    ack: AckCallback
  ) => void;
}

type AckCallback<T = Record<string, never>> = (
  res: AckResponse<T>
) => void;

// ---- Re-export QuestionPublic for use in pages ----
export type { QuestionPublic };

// ---- Module-level socket singleton ----

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    // Always read from env; fallback only for local dev (never used in production).
    const url =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

    if (!url) {
      console.error(
        "[socket] NEXT_PUBLIC_SOCKET_URL is not set. " +
          "Add it to your deployment environment variables."
      );
    }

    console.log("[socket] connecting", { url });

    socket = io(url, {
      autoConnect: false,
      // Start with WebSocket, fall back to polling if the upgrade fails.
      // Polling is required for the initial Socket.IO HTTP handshake on many
      // hosted envs (Render, Railway, etc.) before the WS upgrade completes.
      transports: ["websocket", "polling"],
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
    });

    socket.on("connect", () => {
      console.log("[socket] connecting", { url, id: socket!.id, connected: socket!.connected });
    });
    socket.on("disconnect", (reason) => {
      console.log("[socket] disconnected:", reason);
    });
    socket.on("connect_error", (err) => {
      console.warn("[socket] connection error:", err.message);
    });
  }
  return socket;
}

/**
 * Ensure the socket is connected.
 * Resolves immediately if already connected; otherwise initiates
 * connection and waits up to `timeoutMs` for the 'connect' event.
 */
export async function ensureConnected(
  timeoutMs = 8000
): Promise<Socket<ServerToClientEvents, ClientToServerEvents>> {
  const s = getSocket();
  if (s.connected) return s;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("CONNECT_FAILED"));
    }, timeoutMs);

    s.once("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });

    s.once("connect_error", () => {
      clearTimeout(timer);
      reject(new Error("CONNECT_FAILED"));
    });

    s.connect();
  });
}

// ---- Session storage ----
// Persists identity across page navigations and soft refreshes.
// On full reload, the socket.id changes but we use username+roomCode
// to reconnect (server handles username-based reconnect).

const SS = {
  playerId: "cc_playerId",
  username: "cc_username",
  roomCode: "cc_roomCode",
  hostId:   "cc_hostId",
} as const;

export interface Session {
  playerId: string;
  username: string;
  roomCode: string;
  hostId:   string;
}

export function saveSession(s: Session): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SS.playerId, s.playerId);
  sessionStorage.setItem(SS.username, s.username);
  sessionStorage.setItem(SS.roomCode, s.roomCode);
  sessionStorage.setItem(SS.hostId,   s.hostId);
}

export function loadSession(): Session | null {
  if (typeof sessionStorage === "undefined") return null;
  const playerId = sessionStorage.getItem(SS.playerId);
  const username = sessionStorage.getItem(SS.username);
  const roomCode = sessionStorage.getItem(SS.roomCode);
  const hostId   = sessionStorage.getItem(SS.hostId);
  if (!playerId || !username || !roomCode || !hostId) return null;
  return { playerId, username, roomCode, hostId };
}

export function clearSession(): void {
  if (typeof sessionStorage === "undefined") return;
  Object.values(SS).forEach((k) => sessionStorage.removeItem(k));
}

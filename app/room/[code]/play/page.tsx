// "/room/[code]/play" — Game Play Screen (Phase 4 + auto-voice)
//
// State machine:
//   connecting → question → waiting_reveal → revealed → [next question] → ... → ended
//
// Voice is managed by VoiceContext (room layout) — persistent across lobby↔play.
// This page calls initVoice() after room:join (idempotent — no-op if already connected).

"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import HeaderBar from "@/components/HeaderBar";
import CrayonCard from "@/components/CrayonCard";
import CrayonButton from "@/components/CrayonButton";
import VoiceBar from "@/components/VoiceBar";
import VoicePanel from "@/components/VoicePanel";
import { ToastContainer, useToast } from "@/components/Toast";
import { getSocket, ensureConnected, loadSession, clearSession, saveSession } from "@/lib/socket";
import { toDisplayPlayers } from "@/lib/types";
import { useVoiceControls, useVoiceActivity } from "@/lib/voice/VoiceContext";
import type {
  QuestionPublic,
  GameEndedPayload,
  GameRevealPayload,
  RoomPublicState,
  Player,
} from "@/lib/types";

// ---- Page state machine ----
type PlayState =
  | "connecting"
  | "question"        // answering phase
  | "waiting_reveal"  // answered, waiting for all + game:reveal
  | "revealed"        // reveal received — correct answer + per-player table visible
  | "ended"
  | "expired"
  | "not_found"
  | "connect_error";

// ============================================================
// ScoreBar — module-level component (NEVER inside PlayPage).
//
// If defined inside PlayPage, every PlayPage re-render creates a NEW function
// reference for ScoreBar. React sees a new component type → unmounts the old
// ScoreBar tree → VoiceBar inside it remounts → the Mute button flickers and
// loses click events for a frame.
//
// At module level the reference is stable → React diffs instead of remounts.
// React.memo additionally prevents re-renders when props are unchanged.
// Speaking dots are read via useVoiceActivity() so the ScoreBar can update
// without bubbling the re-render up to PlayPage.
// ============================================================

interface ScoreBarProps {
  displayPlayers: Player[];
  revealData:     GameRevealPayload | null;
  scores:         Record<string, number>;
  mySocketId:     string;
}

const ScoreBar = React.memo(function ScoreBar({
  displayPlayers,
  revealData,
  scores,
  mySocketId,
}: ScoreBarProps) {
  const { speakingIds } = useVoiceActivity();

  return (
    <div
      className="w-full overflow-x-auto"
      style={{ background: "var(--color-paper)", borderBottom: "2px solid var(--color-border)" }}
    >
      <div className="flex min-w-max items-center gap-3 px-4 py-2">
        {displayPlayers
          .filter((p) => p.isConnected)
          .map((p) => {
            const pts        = revealData?.pointsThisRound[p.id];
            const isSpeaking = speakingIds.has(p.id);
            return (
              <div
                key={p.id}
                className="flex items-center gap-1.5 text-sm font-bold"
                style={{ color: p.id === mySocketId ? "var(--color-pink)" : "var(--color-ink)" }}
              >
                {/* Speaking dot — only the dot changes, not the button */}
                {isSpeaking && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: "var(--color-teal)" }}
                    title="Speaking"
                  />
                )}
                <span>{p.isHost ? "👑" : "👤"}</span>
                <span className="max-w-[72px] truncate">{p.username}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs"
                  style={{ background: "var(--color-yellow)", color: "var(--color-ink)" }}
                >
                  {scores[p.id] ?? 0}
                </span>
                {revealData && pts !== undefined && pts > 0 && (
                  <span className="text-xs font-bold" style={{ color: "var(--color-teal)" }}>
                    +{pts}
                  </span>
                )}
              </div>
            );
          })}

        {/* Compact mute toggle — stable because ScoreBar is at module level */}
        <div className="ml-auto flex-shrink-0">
          <VoiceBar />
        </div>
      </div>
    </div>
  );
});

// Difficulty badge colours
const DIFFICULTY_STYLE: Record<string, { bg: string; label: string }> = {
  easy:   { bg: "var(--color-green)",  label: "Easy"   },
  medium: { bg: "var(--color-yellow)", label: "Medium" },
  hard:   { bg: "var(--color-red)",    label: "Hard"   },
};

// ---- Option button style ----
function optionStyle(
  option: string,
  selectedAnswer: string | null,
  revealCorrect: string | null,
  playState: PlayState
): React.CSSProperties & { extraClass: string } {
  if (playState === "question") {
    return {
      background: "var(--color-paper)",
      borderColor: "var(--color-border)",
      color: "var(--color-ink)",
      boxShadow: "3px 3px 0px var(--color-border)",
      extraClass: "hover:-translate-y-0.5 hover:shadow-crayon-lg cursor-pointer",
    };
  }

  if (playState === "waiting_reveal") {
    if (option === selectedAnswer) {
      return {
        background: "var(--color-orange)",
        borderColor: "#c07030",
        color: "#fff",
        boxShadow: "3px 3px 0px #c07030",
        extraClass: "",
      };
    }
    return {
      background: "#e8e0cc",
      borderColor: "#b0a898",
      color: "var(--color-muted)",
      boxShadow: "2px 2px 0px #b0a898",
      extraClass: "opacity-50",
    };
  }

  if (playState === "revealed" && revealCorrect) {
    if (option === revealCorrect) {
      return {
        background: "var(--color-teal)",
        borderColor: "#2a8a84",
        color: "#fff",
        boxShadow: "3px 3px 0px #2a8a84",
        extraClass: "",
      };
    }
    if (option === selectedAnswer) {
      return {
        background: "var(--color-red)",
        borderColor: "#c04040",
        color: "#fff",
        boxShadow: "3px 3px 0px #c04040",
        extraClass: "",
      };
    }
    return {
      background: "#e8e0cc",
      borderColor: "#b0a898",
      color: "var(--color-muted)",
      boxShadow: "2px 2px 0px #b0a898",
      extraClass: "opacity-60",
    };
  }

  return {
    background: "var(--color-paper)",
    borderColor: "var(--color-border)",
    color: "var(--color-ink)",
    boxShadow: "3px 3px 0px var(--color-border)",
    extraClass: "",
  };
}

function makeTraceId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isRoomNotFound(msg: string) {
  return msg.toLowerCase().includes("not found");
}

export default function PlayPage() {
  const params  = useParams();
  const router  = useRouter();
  const rawCode = params.code as string | undefined;
  const code    = rawCode ? rawCode.toUpperCase() : "";
  const { toasts, addToast, dismissToast } = useToast();
  // Only read initVoice — PlayPage must NOT subscribe to speakingIds.
  // Speaking changes fire every 100 ms; subscribing here would cause PlayPage to
  // re-render → ScoreBar function recreated → Mute button remounts → flicker.
  // ScoreBar is a module-level component and reads speakingIds via useVoiceActivity().
  const { initVoice } = useVoiceControls();

  const [playState, setPlayState]           = useState<PlayState>("connecting");
  const [question, setQuestion]             = useState<QuestionPublic | null>(null);
  const [questionIndex, setQuestionIndex]   = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [scores, setScores]                 = useState<Record<string, number>>({});
  const [revealData, setRevealData]         = useState<GameRevealPayload | null>(null);
  const [answeredCount, setAnsweredCount]   = useState(0);
  const [playerCount, setPlayerCount]       = useState(0);
  const [endedData, setEndedData]           = useState<GameEndedPayload | null>(null);
  const [displayPlayers, setDisplayPlayers] = useState<Player[]>([]);
  const [mySocketId, setMySocketId]         = useState("");
  const [myUsername, setMyUsername]         = useState("");
  const [isAdvancing, setIsAdvancing]       = useState(false);
  const [isForceRevealing, setIsForceRevealing] = useState(false);

  const hasConnected = useRef(false);
  const hasJoined    = useRef(false);

  const isHost = !!displayPlayers.find(
    (p) => p.isConnected && p.isHost && p.id === mySocketId
  );

  // ---- Auto-start voice once we have identity (idempotent) ----
  useEffect(() => {
    if (!mySocketId || !myUsername) return;
    initVoice(mySocketId, myUsername);
  }, [mySocketId, myUsername, initVoice]);

  // ---- Initial connect + subscribe ----
  useEffect(() => {
    if (!code) { setPlayState("expired"); return; }
    if (hasConnected.current) return;
    hasConnected.current = true;

    const traceId = makeTraceId();

    async function connect() {
      const session = loadSession();
      if (!session) { setPlayState("expired"); return; }
      setMyUsername(session.username);

      try {
        const socket = await ensureConnected();
        setMySocketId(socket.id ?? "");

        socket.on("game:question", ({ questionIndex: qi, totalQuestions: total, question: q, scores: s }) => {
          setQuestion(q);
          setQuestionIndex(qi);
          setTotalQuestions(total);
          setScores(s);
          setSelectedAnswer(null);
          setRevealData(null);
          setAnsweredCount(0);
          setIsAdvancing(false);
          setIsForceRevealing(false);
          setPlayState("question");
        });

        socket.on("game:player-answered", ({ count, total }) => {
          setAnsweredCount(count);
          setPlayerCount(total);
        });

        socket.on("game:reveal", (data: GameRevealPayload) => {
          setRevealData(data);
          setScores(data.scores);
          setPlayState("revealed");
          setIsForceRevealing(false);
        });

        socket.on("game:ended", (data) => {
          setEndedData(data);
          setPlayState("ended");
        });

        socket.on("room:updated", (state: RoomPublicState) => {
          setDisplayPlayers(toDisplayPlayers(state.players));
          setScores(state.scores);
          setMySocketId(socket.id ?? "");
        });

        socket.on("game:started", () => {
          setEndedData(null);
          setSelectedAnswer(null);
          setRevealData(null);
          setAnsweredCount(0);
          setIsAdvancing(false);
          setIsForceRevealing(false);
        });

        const result = await new Promise<{
          playerId: string; hostId: string; state: RoomPublicState;
        }>((resolve, reject) => {
          socket.emit(
            "room:join",
            { roomCode: code, username: session.username, traceId },
            (res) => {
              if (res.success) resolve(res);
              else reject(new Error(res.error));
            }
          );
        });

        hasJoined.current = true;

        saveSession({
          playerId: result.playerId,
          username: session.username,
          roomCode: code,
          hostId: result.hostId,
        });

        setMySocketId(result.playerId);
        setMyUsername(session.username);
        setDisplayPlayers(toDisplayPlayers(result.state.players));
        setScores(result.state.scores);
        setPlayerCount(result.state.players.length);

        const state = result.state;
        if (state.status === "in_game" && state.currentQuestion) {
          setQuestion(state.currentQuestion);
          setQuestionIndex(state.questionIndex);
          setTotalQuestions(state.totalQuestions);
          setPlayState("question");
        } else if (state.status === "ended") {
          setPlayState("expired");
        } else {
          router.replace(`/room/${code}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "CONNECT_FAILED") setPlayState("connect_error");
        else if (isRoomNotFound(msg)) setPlayState("not_found");
        else setPlayState("expired");
      }
    }

    connect();

    return () => {
      const s = getSocket();
      s.off("game:question");
      s.off("game:player-answered");
      s.off("game:reveal");
      s.off("game:ended");
      s.off("room:updated");
      s.off("game:started");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- Socket reconnect ----
  useEffect(() => {
    if (!code) return;

    function handleReconnect() {
      if (!hasJoined.current) return;
      const session = loadSession();
      if (!session || session.roomCode !== code) return;

      const reconnectTraceId = makeTraceId();
      const socket = getSocket();
      setMySocketId(socket.id ?? "");

      socket.emit(
        "room:join",
        { roomCode: code, username: session.username, traceId: reconnectTraceId },
        (res) => {
          if (res.success) {
            saveSession({ playerId: res.playerId, username: session.username, roomCode: code, hostId: res.hostId });
            setMySocketId(res.playerId);
            setDisplayPlayers(toDisplayPlayers(res.state.players));
            setScores(res.state.scores);
          } else {
            setPlayState(isRoomNotFound(res.error) ? "not_found" : "expired");
          }
        }
      );
    }

    const socket = getSocket();
    socket.on("connect", handleReconnect);
    return () => { socket.off("connect", handleReconnect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- Answer selection → emit game:answer ----
  const handleAnswer = useCallback(
    (option: string) => {
      if (playState !== "question" || !question) return;
      setSelectedAnswer(option);
      setPlayState("waiting_reveal");

      const socket = getSocket();
      socket.emit(
        "game:answer",
        { roomCode: code, questionId: question.id, answer: option },
        (res) => {
          if (!res.success) {
            console.warn("[play:game:answer] rejected:", res.error);
            setSelectedAnswer(null);
            setPlayState("question");
          }
        }
      );
    },
    [playState, question, code]
  );

  // ---- Force reveal (host only) ----
  const handleForceReveal = useCallback(() => {
    if (!isHost || isForceRevealing) return;
    setIsForceRevealing(true);
    getSocket().emit("game:force-reveal", { roomCode: code }, (res) => {
      if (!res.success) {
        addToast(res.error ?? "Could not reveal.", "error");
        setIsForceRevealing(false);
      }
    });
  }, [isHost, isForceRevealing, code, addToast]);

  // ---- Advance to next question (host, after reveal) ----
  const handleNext = useCallback(() => {
    if (!isHost || isAdvancing) return;
    setIsAdvancing(true);
    getSocket().emit("game:next", { roomCode: code }, (res) => {
      if (!res.success) {
        addToast(res.error ?? "Could not advance.", "error");
        setIsAdvancing(false);
      }
    });
  }, [isHost, isAdvancing, code, addToast]);

  // ---- Play again ----
  const handlePlayAgain = useCallback(() => {
    getSocket().emit("game:new", { roomCode: code }, (res) => {
      if (!res.success) addToast(res.error ?? "Could not start a new game.", "error");
    });
  }, [code, addToast]);

  // ---- Leave ----
  function handleLeave() {
    clearSession();
    router.push("/");
  }


  // ============================================================
  // Connecting
  // ============================================================
  if (playState === "connecting") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-16 flex flex-col items-center gap-4">
            <div
              className="h-12 w-12 animate-spin rounded-full border-4"
              style={{ borderColor: "var(--color-yellow)", borderTopColor: "transparent" }}
              role="status" aria-label="Loading game…"
            />
            <p className="text-lg font-bold" style={{ color: "var(--color-muted)" }}>Loading game…</p>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Connection error
  // ============================================================
  if (playState === "connect_error") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-8">
            <CrayonCard variant="muted">
              <h2 className="mb-2" style={{ color: "var(--color-ink)" }}>Can&apos;t Connect</h2>
              <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
                Can&apos;t connect to the game server. Refresh the page or check your network.
              </p>
              <CrayonButton variant="primary" size="md" onClick={() => window.location.reload()}>
                Refresh
              </CrayonButton>
            </CrayonCard>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Not found
  // ============================================================
  if (playState === "not_found") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-8">
            <CrayonCard variant="error">
              <h2 className="mb-2" style={{ color: "var(--color-ink)" }}>Room Not Found</h2>
              <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
                This room no longer exists. The server may have restarted or the room expired.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <CrayonButton variant="primary" size="md" fullWidth onClick={() => router.push(`/join?code=${code}`)}>
                  🔑 Rejoin Room
                </CrayonButton>
                <CrayonButton variant="ghost" size="md" fullWidth onClick={handleLeave}>← Home</CrayonButton>
              </div>
            </CrayonCard>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Expired
  // ============================================================
  if (playState === "expired") {
    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-8">
            <CrayonCard variant="error">
              <h2 className="mb-2" style={{ color: "var(--color-ink)" }}>Session Expired</h2>
              <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
                Your session has expired or the game is not in progress.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <CrayonButton variant="primary" size="md" fullWidth onClick={() => router.replace(`/room/${code}`)}>
                  ↩ Back to Lobby
                </CrayonButton>
                <CrayonButton variant="ghost" size="md" fullWidth onClick={handleLeave}>← Home</CrayonButton>
              </div>
            </CrayonCard>
          </div>
        </PageShell>
      </>
    );
  }

  // ============================================================
  // Game Ended — leaderboard
  // ============================================================
  if (playState === "ended" && endedData) {
    const { leaderboard, winner } = endedData;
    const medals = ["🥇", "🥈", "🥉", "4️⃣"];

    return (
      <>
        <HeaderBar />
        <PageShell>
          <div className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-6xl" aria-hidden="true">🏆</span>
              <h1 style={{ color: "var(--color-ink)" }}>Game Over!</h1>
              {winner && (
                <p className="text-lg font-bold" style={{ color: "var(--color-orange)" }}>
                  {winner} wins! 🎉
                </p>
              )}
            </div>

            <CrayonCard aria-label="Final scores">
              <h2 className="mb-3" style={{ color: "var(--color-ink)" }}>Final Scores</h2>
              <div className="flex flex-col gap-2">
                {leaderboard.map((entry, i) => (
                  <div
                    key={entry.id}
                    className={[
                      "flex items-center justify-between rounded-crayon border-[2px] px-3 py-2.5",
                      i === 0 ? "border-[var(--color-border)]" : "border-[var(--color-muted)]",
                    ].join(" ")}
                    style={{ background: i === 0 ? "var(--color-yellow)" : "var(--color-paper)" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl" aria-hidden="true">{medals[i] ?? ""}</span>
                      <span className="font-bold" style={{ color: "var(--color-ink)", opacity: entry.id === mySocketId ? 1 : 0.85 }}>
                        {entry.username}
                        {entry.id === mySocketId && (
                          <span className="ml-1 text-xs" style={{ color: "var(--color-pink)" }}>(you)</span>
                        )}
                      </span>
                    </div>
                    <span className="text-lg font-bold" style={{ color: "var(--color-ink)" }}>
                      {entry.score} pts
                    </span>
                  </div>
                ))}
              </div>
            </CrayonCard>

            {/* Voice panel on end screen */}
            <VoicePanel mySocketId={mySocketId} roomPlayers={displayPlayers} />

            <div className="flex flex-col gap-3 sm:flex-row">
              {isHost && (
                <CrayonButton variant="primary" size="lg" fullWidth onClick={handlePlayAgain}>
                  🔄 Play Again
                </CrayonButton>
              )}
              <CrayonButton variant="ghost" size="lg" fullWidth onClick={handleLeave}>
                ← Leave Room
              </CrayonButton>
            </div>

            {!isHost && (
              <p className="text-center text-sm animate-soft-pulse" style={{ color: "var(--color-muted)" }}>
                Waiting for host to start a new game…
              </p>
            )}
          </div>
        </PageShell>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  // ============================================================
  // Question / Waiting / Revealed
  // ============================================================
  if (!question) return null;

  const isCorrect   = selectedAnswer === revealData?.correct;
  const diffInfo    = DIFFICULTY_STYLE[question.difficulty] ?? DIFFICULTY_STYLE.medium;
  const progressPct = ((questionIndex + 1) / totalQuestions) * 100;
  const myPoints    = revealData?.pointsThisRound[mySocketId];

  return (
    <>
      {/* Sticky header + score bar */}
      <div className="sticky top-0 z-50">
        <HeaderBar />
        <ScoreBar
          displayPlayers={displayPlayers}
          revealData={revealData}
          scores={scores}
          mySocketId={mySocketId}
        />
      </div>

      <PageShell>
        {/* Progress label */}
        <div className="mt-4 mb-2 flex items-center justify-between text-sm font-bold" style={{ color: "var(--color-muted)" }}>
          <span>Question {questionIndex + 1} of {totalQuestions}</span>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: diffInfo.bg, color: "var(--color-ink)" }}
            >
              {diffInfo.label}
            </span>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{question.category}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div
          className="mb-4 h-3 w-full overflow-hidden rounded-full border-2"
          style={{ background: "#e8e0cc", borderColor: "var(--color-border)" }}
          role="progressbar"
          aria-valuenow={questionIndex + 1}
          aria-valuemin={1}
          aria-valuemax={totalQuestions}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%`, background: "var(--color-yellow)" }}
          />
        </div>

        {/* ── REVEAL: result banner + per-player table ── */}
        {playState === "revealed" && revealData && (
          <>
            {/* My result */}
            <CrayonCard
              variant={isCorrect ? "highlight" : "error"}
              className="mb-3 flex items-center gap-3 py-3"
            >
              <span className="text-2xl" aria-hidden="true">{isCorrect ? "✓" : "✗"}</span>
              <div className="flex-1">
                <p className="font-bold" style={{ color: "var(--color-ink)" }}>
                  {isCorrect ? "Correct!" : "Wrong!"}
                </p>
                {!isCorrect && (
                  <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                    Correct: <strong>{revealData.correct}</strong>
                  </p>
                )}
              </div>
              {myPoints !== undefined && (
                <span
                  className="text-xl font-bold"
                  style={{ color: myPoints > 0 ? "var(--color-teal)" : "var(--color-muted)" }}
                >
                  {myPoints > 0 ? `+${myPoints}` : "0"}
                </span>
              )}
            </CrayonCard>

            {/* Fastest highlight */}
            {revealData.fastestSentence && (
              <CrayonCard variant="highlight" className="mb-3 py-2.5 text-center">
                <p className="font-bold text-sm" style={{ color: "var(--color-ink)" }}>
                  {revealData.fastestSentence}
                </p>
              </CrayonCard>
            )}

            {/* Per-player answer table */}
            <CrayonCard className="mb-4">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                Everyone&apos;s answers
              </h3>
              <div className="flex flex-col gap-2">
                {revealData.perPlayer.map((entry) => {
                  const isFastest = entry.playerId === revealData.fastestPlayerId;
                  const isMe = entry.playerId === mySocketId;
                  return (
                    <div
                      key={entry.playerId}
                      className="flex items-center justify-between gap-2 rounded-crayon border-[2px] px-3 py-2"
                      style={{
                        borderColor: isFastest ? "var(--color-yellow)" : "var(--color-muted)",
                        background: isFastest ? "#fffae8" : "var(--color-paper)",
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isFastest && <span title="Fastest click">⚡</span>}
                        <span
                          className="truncate text-sm font-bold"
                          style={{ color: isMe ? "var(--color-pink)" : "var(--color-ink)" }}
                        >
                          {entry.username}
                          {isMe && <span className="ml-1 text-xs opacity-70">(you)</span>}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-sm">
                        {entry.selectedOption ? (
                          <>
                            <span
                              className="max-w-[100px] truncate"
                              style={{ color: "var(--color-ink)" }}
                              title={entry.selectedOption}
                            >
                              {entry.selectedOption}
                            </span>
                            <span
                              className="font-bold"
                              style={{ color: entry.isCorrect ? "var(--color-teal)" : "var(--color-red)" }}
                            >
                              {entry.isCorrect ? "✓" : "✗"}
                            </span>
                            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                              {entry.timeTakenSeconds}s
                            </span>
                          </>
                        ) : (
                          <span className="text-xs italic" style={{ color: "var(--color-muted)" }}>
                            No answer
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CrayonCard>
          </>
        )}

        {/* Question text */}
        <CrayonCard className="mb-4">
          <p className="text-lg font-bold leading-snug" style={{ color: "var(--color-ink)" }}>
            {question.text}
          </p>
        </CrayonCard>

        {/* Answer options */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {question.options.map((option) => {
            const { extraClass, ...style } = optionStyle(
              option,
              selectedAnswer,
              revealData?.correct ?? null,
              playState
            );
            return (
              <button
                key={option}
                onClick={() => handleAnswer(option)}
                disabled={playState !== "question"}
                className={[
                  "w-full rounded-crayon border-[2.5px] p-4 text-left font-crayon text-base font-bold",
                  "transition-all duration-150 min-h-[56px]",
                  playState === "question"
                    ? "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                    : "",
                  extraClass,
                ].join(" ")}
                style={style}
                aria-pressed={selectedAnswer === option}
                aria-label={`Answer: ${option}`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {/* ── Waiting for reveal ── */}
        {playState === "waiting_reveal" && (
          <>
            <CrayonCard variant="muted" className="mb-4 py-3 text-center">
              <p className="text-sm font-bold" style={{ color: "var(--color-ink)" }}>
                ⏳ Answer locked in!
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                {answeredCount} / {playerCount} answered — waiting for others…
              </p>
            </CrayonCard>

            {isHost && (
              <CrayonButton
                variant="ghost"
                size="md"
                fullWidth
                onClick={handleForceReveal}
                disabled={isForceRevealing}
                aria-busy={isForceRevealing}
              >
                {isForceRevealing ? "Revealing…" : "⏭ Skip — Reveal Now"}
              </CrayonButton>
            )}
          </>
        )}

        {/* ── Unanswered hint ── */}
        {playState === "question" && (
          <p className="text-center text-sm" style={{ color: "var(--color-muted)" }}>
            Click your answer above!
          </p>
        )}

        {/* ── Post-reveal: voice panel + next button ── */}
        {playState === "revealed" && (
          <>
            <VoicePanel mySocketId={mySocketId} roomPlayers={displayPlayers} />

            {isHost ? (
              <CrayonButton
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleNext}
                disabled={isAdvancing}
                aria-busy={isAdvancing}
              >
                {isAdvancing
                  ? "Loading…"
                  : questionIndex + 1 >= totalQuestions
                  ? "📊 Show Results"
                  : `▶ Next Question (${questionIndex + 2}/${totalQuestions})`}
              </CrayonButton>
            ) : (
              <CrayonCard variant="muted" className="py-3 text-center">
                <p className="text-sm animate-soft-pulse" style={{ color: "var(--color-muted)" }}>
                  Waiting for host to advance…
                </p>
              </CrayonCard>
            )}
          </>
        )}
      </PageShell>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

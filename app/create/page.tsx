// "/create" — Create Room page (Phase 2)
//
// Flow:
//   1. User enters username
//   2. Click "Create Room" → connect socket → emit room:create
//   3. Server returns { roomCode, playerId, hostId }
//   4. Save session to sessionStorage
//   5. Navigate to /room/[code]
//
// Category selection was moved to the Room Lobby (host can change it there).

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import HeaderBar from "@/components/HeaderBar";
import CrayonCard from "@/components/CrayonCard";
import CrayonButton from "@/components/CrayonButton";
import CrayonInput from "@/components/CrayonInput";
import { ToastContainer, useToast } from "@/components/Toast";
import { validateUsername, sanitizeUsername } from "@/lib/utils";
import { ensureConnected, saveSession } from "@/lib/socket";

export default function CreateRoomPage() {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();

  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    const clean = sanitizeUsername(username);
    const err = validateUsername(clean);
    if (err) { setUsernameError(err); return; }
    setUsernameError(undefined);
    setIsCreating(true);

    try {
      const socket = await ensureConnected();

      // Use a promise wrapper around the ack callback
      const result = await new Promise<{ roomCode: string; playerId: string; hostId: string }>(
        (resolve, reject) => {
          socket.emit("room:create", { username: clean }, (res) => {
            if (res.success) resolve(res);
            else reject(new Error(res.error));
          });
        }
      );

      saveSession({
        playerId: result.playerId,
        username: clean,
        roomCode: result.roomCode,
        hostId: result.hostId,
      });

      router.push(`/room/${result.roomCode}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setIsCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
  }

  return (
    <>
      <HeaderBar />
      <PageShell>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-1 text-sm font-bold underline-offset-2 hover:underline"
          style={{ color: "var(--color-muted)" }}
        >
          ← Back to home
        </Link>

        <h1 className="mb-6 mt-3" style={{ color: "var(--color-ink)" }}>
          Create a Room
        </h1>

        <CrayonCard className="flex flex-col gap-5">
          <CrayonInput
            label="Your Name"
            placeholder="e.g. TriviaWizard"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (usernameError) setUsernameError(undefined);
            }}
            onKeyDown={handleKeyDown}
            error={usernameError}
            helperText="2–20 characters. This is how others will see you."
            maxLength={20}
            autoFocus
            autoComplete="off"
            disabled={isCreating}
          />

          <hr className="border-dashed" style={{ borderColor: "var(--color-muted)" }} />

          <CrayonCard variant="highlight" className="py-3 text-sm">
            <p>
              <strong>Tip:</strong> You&apos;ll pick the trivia category inside
              the room lobby. A 6-character code is generated for friends to
              join via{" "}
              <Link href="/join" className="underline" style={{ color: "var(--color-ink)" }}>
                Enter Room
              </Link>
              .
            </p>
          </CrayonCard>

          <CrayonButton
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleCreate}
            disabled={isCreating}
            aria-busy={isCreating}
          >
            {isCreating ? "Creating…" : "🎉 Create Room"}
          </CrayonButton>
        </CrayonCard>
      </PageShell>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

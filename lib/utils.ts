// ============================================================
// ClickClash — Utility Helpers
// Pure functions, no side effects, fully typed.
// ============================================================

/**
 * Generate a random alphanumeric room code.
 * Uses uppercase letters + digits for easy readability.
 * Example output: "K4X9PL"
 */
export function generateRoomCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit 0/O/1/I (confusable)
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Sanitize a username: trim whitespace and collapse internal spaces.
 * Returns the sanitized string (may be empty — callers should validate).
 */
export function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Validate a username and return an error message, or null if valid.
 * Rules: 2–20 chars, alphanumeric + spaces + hyphens.
 */
export function validateUsername(username: string): string | null {
  const clean = sanitizeUsername(username);
  if (clean.length === 0) return "Username is required.";
  if (clean.length < 2) return "Username must be at least 2 characters.";
  if (clean.length > 20) return "Username must be 20 characters or less.";
  if (!/^[a-zA-Z0-9 _-]+$/.test(clean)) {
    return "Only letters, numbers, spaces, hyphens, and underscores allowed.";
  }
  return null;
}

/**
 * Validate a room code and return an error message, or null if valid.
 * Room codes are 6 uppercase alphanumeric characters.
 */
export function validateRoomCode(code: string): string | null {
  const clean = code.trim().toUpperCase();
  if (clean.length === 0) return "Room code is required.";
  if (clean.length !== 6) return "Room code must be exactly 6 characters.";
  if (!/^[A-Z0-9]+$/.test(clean)) return "Room code contains invalid characters.";
  return null;
}

/**
 * Build the full URL for a room.
 * Works in both browser and SSR contexts.
 */
export function buildRoomUrl(
  code: string,
  username: string,
  isHost: boolean
): string {
  const params = new URLSearchParams({
    name: username,
    host: isHost ? "1" : "0",
  });
  return `/room/${code}?${params.toString()}`;
}

/**
 * Copy text to clipboard and return a boolean indicating success.
 * Falls back gracefully if the Clipboard API is unavailable.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Legacy fallback
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Create a short unique ID for toasts / mock player IDs.
 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Build the 4 player slots for the lobby:
 * slot 0 = current user, slots 1-3 = "Waiting…" placeholders.
 * Phase 2+ will replace this with real socket data.
 */
export function buildMockPlayers(
  username: string,
  isHost: boolean
): import("./types").Player[] {
  return [
    {
      id: uid(),
      username,
      isHost,
      isConnected: true,
      isSpeaking: false,
      score: 0,
    },
    { id: "slot-1", username: "Waiting…", isHost: false, isConnected: false },
    { id: "slot-2", username: "Waiting…", isHost: false, isConnected: false },
    { id: "slot-3", username: "Waiting…", isHost: false, isConnected: false },
  ];
}

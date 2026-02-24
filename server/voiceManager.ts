// VoiceManager — tracks which sockets are in "voice mode" per room.
// Signaling (offer/answer/ice) is relayed here — no media flows through the server.
// Mesh topology: every voice participant connects directly to every other.

export class VoiceManager {
  // roomCode → Map<socketId, username>
  private rooms = new Map<string, Map<string, string>>();

  /**
   * Join voice for a room.
   * Returns the list of peers already in voice (so the new joiner can send offers to them).
   */
  join(
    roomCode: string,
    socketId: string,
    username: string
  ): Array<{ socketId: string; username: string }> {
    if (!this.rooms.has(roomCode)) this.rooms.set(roomCode, new Map());
    const room = this.rooms.get(roomCode)!;

    // Collect existing peers before adding self
    const peers = Array.from(room.entries()).map(([sid, uname]) => ({
      socketId: sid,
      username: uname,
    }));

    room.set(socketId, username);
    return peers;
  }

  /**
   * Leave voice for a specific room.
   * Returns the number of remaining participants.
   */
  leave(roomCode: string, socketId: string): number {
    const room = this.rooms.get(roomCode);
    if (!room) return 0;
    room.delete(socketId);
    if (room.size === 0) this.rooms.delete(roomCode);
    return room?.size ?? 0;
  }

  /**
   * Remove a socket from ALL rooms it was in voice for (on disconnect).
   * Returns the affected roomCodes so the server can broadcast voice:peer-left.
   */
  leaveAll(socketId: string): string[] {
    const affected: string[] = [];
    for (const [roomCode, room] of this.rooms) {
      if (room.has(socketId)) {
        room.delete(socketId);
        affected.push(roomCode);
        if (room.size === 0) this.rooms.delete(roomCode);
      }
    }
    return affected;
  }

  /** Check if a socket is currently in voice for a room. */
  isInVoice(roomCode: string, socketId: string): boolean {
    return this.rooms.get(roomCode)?.has(socketId) ?? false;
  }

  /** Returns all active voice room codes — used for diagnostics/logging. */
  listRoomCodes(): string[] {
    return Array.from(this.rooms.keys());
  }
}

/**
 * @file RoomManager.js
 * In-memory registry and lifecycle manager for watch party rooms.
 * Source of truth: docs/02-architecture.md §5 & §7
 */

import { Room } from './Room.js';
import { Participant } from './Participant.js';
import { ROLES } from './PermissionService.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { generateSessionToken, hashToken } from '../utils/token.js';
import { env } from '../config/env.js';

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  /**
   * Creates a new watch party room with the creator registered as the Host.
   * @param {Object} params
   * @param {string} params.username - Room creator's screen name
   * @param {string|null} [params.videoId=null] - Optional initial YouTube video ID
   * @returns {{ room: Room, host: Participant, sessionToken: string }}
   */
  createRoom({ username, videoId = null }) {
    // Generate an 8-char room code, guaranteeing no collision
    let roomId = generateRoomCode();
    let attempts = 0;
    while (this.rooms.has(roomId)) {
      roomId = generateRoomCode();
      attempts++;
      if (attempts > 100) {
        throw new Error('Failed to generate unique room code.');
      }
    }

    const room = new Room({ id: roomId, initialVideoId: videoId });

    // Generate high-entropy 256-bit session token for creator authentication
    const rawSessionToken = generateSessionToken();
    const sessionTokenHash = hashToken(rawSessionToken);

    // Create Host participant
    const host = new Participant({
      username,
      role: ROLES.HOST,
      sessionTokenHash,
    });

    room.addParticipant(host);
    this.rooms.set(roomId, room);

    return {
      room,
      host,
      sessionToken: rawSessionToken,
    };
  }

  /**
   * Finds a room by ID (case-insensitive normalization).
   * @param {string} roomId
   * @returns {Room | undefined}
   */
  getRoom(roomId) {
    if (!roomId || typeof roomId !== 'string') return undefined;
    return this.rooms.get(roomId.toUpperCase().trim());
  }

  /**
   * Deletes a room from memory.
   * @param {string} roomId
   * @returns {boolean}
   */
  deleteRoom(roomId) {
    if (!roomId) return false;
    return this.rooms.delete(roomId.toUpperCase().trim());
  }

  /**
   * Cleans up empty rooms that have exceeded EMPTY_ROOM_TTL_MINUTES.
   * @param {number} [ttlMinutes=env.EMPTY_ROOM_TTL_MINUTES]
   */
  sweepEmptyRooms(ttlMinutes = env.EMPTY_ROOM_TTL_MINUTES) {
    const cutoff = Date.now() - ttlMinutes * 60 * 1000;
    for (const [id, room] of this.rooms.entries()) {
      if (room.participantCount === 0 && room.lastActivityAt < cutoff) {
        this.rooms.delete(id);
      }
    }
  }
}

// Global in-memory singleton instance
export const roomManager = new RoomManager();

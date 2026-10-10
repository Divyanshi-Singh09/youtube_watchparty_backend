/**
 * @file Participant.js
 * Model representing a room participant.
 * Source of truth: docs/02-architecture.md §5 and docs/04-websocket-events.md §1
 */

import crypto from 'node:crypto';
import { ROLES } from './PermissionService.js';

export class Participant {
  /**
   * @param {Object} params
   * @param {string} [params.userId] - UUID v4 (generated if omitted)
   * @param {string} params.username - Screen name (trimmed, 1-30 chars)
   * @param {string} [params.role=ROLES.PARTICIPANT] - 'host' | 'moderator' | 'participant'
   * @param {string|null} [params.socketId=null] - Currently connected socket ID
   * @param {string} params.sessionTokenHash - SHA-256 hash of the participant's secret token
   * @param {number} [params.joinedAt=Date.now()]
   */
  constructor({
    userId = crypto.randomUUID(),
    username,
    role = ROLES.PARTICIPANT,
    socketId = null,
    sessionTokenHash,
    joinedAt = Date.now(),
  }) {
    this.userId = userId;
    this.username = username.trim();
    this.role = role;
    this.socketId = socketId;
    this.sessionTokenHash = sessionTokenHash;
    this.joinedAt = joinedAt;
  }

  /**
   * Serializes the participant for wire broadcast (View/DTO).
   * Omits sensitive fields like sessionTokenHash.
   * @returns {{ userId: string, username: string, role: string }}
   */
  toDTO() {
    return {
      userId: this.userId,
      username: this.username,
      role: this.role,
    };
  }
}

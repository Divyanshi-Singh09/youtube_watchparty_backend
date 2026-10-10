/**
 * @file Room.js
 * Model representing an active watch party room and its domain invariants.
 * Source of truth: docs/02-architecture.md §5 & §7, and docs/04-websocket-events.md
 */

import { randomUUID } from 'node:crypto';
import { PlaybackState } from './PlaybackState.js';
import { ROLES } from './PermissionService.js';
import { env } from '../config/env.js';


export class RoomError extends Error {
  /**
   * @param {string} code - ErrorCode string from docs/04-websocket-events.md §1
   * @param {string} message - Descriptive error message
   */
  constructor(code, message) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

export class Room {
  /**
   * @param {Object} params
   * @param {string} params.id - 8-character room code
   * @param {string|null} [params.initialVideoId=null]
   * @param {number} [params.maxParticipants=env.MAX_PARTICIPANTS_PER_ROOM]
   */
  constructor({
    id,
    initialVideoId = null,
    maxParticipants = env.MAX_PARTICIPANTS_PER_ROOM,
  }) {
    this.id = id;
    this.playback = new PlaybackState({ videoId: initialVideoId });
    this.participants = new Map(); // Map<userId, Participant>
    this.changeRequests = new Map(); // Map<requestId, { requestId, userId, username, action, status, createdAt }>
    this.maxParticipants = maxParticipants;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }


  /**
   * Current number of joined participants.
   * @returns {number}
   */
  get participantCount() {
    return this.participants.size;
  }

  /**
   * Retrieves the current host of the room.
   * @returns {import('./Participant.js').Participant | undefined}
   */
  getHost() {
    for (const participant of this.participants.values()) {
      if (participant.role === ROLES.HOST) {
        return participant;
      }
    }
    return undefined;
  }

  /**
   * Adds a participant, verifying room capacity and username uniqueness.
   * @param {import('./Participant.js').Participant} participant
   */
  addParticipant(participant) {
    if (this.participants.size >= this.maxParticipants) {
      throw new RoomError('ROOM_FULL', 'Room has reached maximum participant capacity.');
    }

    // Enforce case-insensitive unique usernames (per doc 02 §7)
    const normalizedUsername = participant.username.toLowerCase();
    for (const existing of this.participants.values()) {
      if (existing.username.toLowerCase() === normalizedUsername) {
        throw new RoomError('USERNAME_TAKEN', `Username "${participant.username}" is already taken in this room.`);
      }
    }

    // Invariant: Exactly one host per room
    if (participant.role === ROLES.HOST && this.getHost()) {
      throw new RoomError('FORBIDDEN', 'Room already has a host.');
    }

    this.participants.set(participant.userId, participant);
    this.lastActivityAt = Date.now();
  }

  /**
   * Retrieves participant by userId.
   * @param {string} userId
   * @returns {import('./Participant.js').Participant | undefined}
   */
  getParticipant(userId) {
    return this.participants.get(userId);
  }

  /**
   * Looks up a participant by their session token hash (used for reconnect and host identification).
   * @param {string} tokenHash
   * @returns {import('./Participant.js').Participant | undefined}
   */
  findParticipantByTokenHash(tokenHash) {
    for (const participant of this.participants.values()) {
      if (participant.sessionTokenHash === tokenHash) {
        return participant;
      }
    }
    return undefined;
  }

  /**
   * Removes a participant from the room.
   * Invariant: Cannot remove the host via this method.
   * @param {string} targetUserId
   * @returns {import('./Participant.js').Participant} The removed participant
   */
  removeParticipant(targetUserId) {
    const participant = this.participants.get(targetUserId);
    if (!participant) {
      throw new RoomError('TARGET_NOT_FOUND', 'Participant not found in room.');
    }

    if (participant.role === ROLES.HOST) {
      throw new RoomError('INVALID_TARGET', 'The host cannot be removed from the room.');
    }

    this.participants.delete(targetUserId);
    this.cancelPendingRequestsForUser(targetUserId);
    this.lastActivityAt = Date.now();
    return participant;
  }

  /**
   * Assigns a new role to an existing participant.
   * Invariants:
   * - Cannot change the host's role here
   * - Cannot assign 'host' role via assign_role
   * @param {string} targetUserId
   * @param {string} newRole - 'moderator' | 'participant'
   */
  assignRole(targetUserId, newRole) {
    const target = this.participants.get(targetUserId);
    if (!target) {
      throw new RoomError('TARGET_NOT_FOUND', 'Target participant not found.');
    }

    if (target.role === ROLES.HOST) {
      throw new RoomError('INVALID_TARGET', 'Cannot reassign role of the room host.');
    }

    if (newRole !== ROLES.MODERATOR && newRole !== ROLES.PARTICIPANT) {
      throw new RoomError('INVALID_ROLE', 'Invalid role. Only moderator or participant may be assigned.');
    }

    const roleChanged = target.role !== newRole;
    target.role = newRole;
    this.lastActivityAt = Date.now();
    return { target, roleChanged };
  }

  /**
   * Handles explicit participant departure via leave_room.
   * If leaver is host: auto-promotes earliest joined member (moderator first, then participant) if any remain.
   * @param {string} userId
   * @returns {{ leaver: import('./Participant.js').Participant, promotedHost?: import('./Participant.js').Participant }}
   */
  handleLeave(userId) {
    const leaver = this.participants.get(userId);
    if (!leaver) {
      throw new RoomError('TARGET_NOT_FOUND', 'Participant not found in room.');
    }

    this.participants.delete(userId);
    this.cancelPendingRequestsForUser(userId);
    this.lastActivityAt = Date.now();

    let promotedHost = undefined;
    if (leaver.role === ROLES.HOST && this.participants.size > 0) {
      // Find candidate: earliest moderator, else earliest participant
      const remaining = Array.from(this.participants.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      );
      promotedHost = remaining.find((p) => p.role === ROLES.MODERATOR) || remaining[0];
      if (promotedHost) {
        promotedHost.role = ROLES.HOST;
      }
    }

    return { leaver, promotedHost };
  }

  /**
   * Cancels any pending requests for a user who left or was removed.
   * @param {string} userId
   */
  cancelPendingRequestsForUser(userId) {
    for (const request of this.changeRequests.values()) {
      if (request.userId === userId && request.status === 'pending') {
        request.status = 'cancelled';
      }
    }
  }

  /**
   * Adds a new change request from a participant.
   * Capped at 5 pending requests per participant (RATE_LIMITED).
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.username
   * @param {Object} params.action
   * @returns {Object} The created request
   */
  addChangeRequest({ userId, username, action }) {
    let pendingCount = 0;
    for (const req of this.changeRequests.values()) {
      if (req.userId === userId && req.status === 'pending') {
        pendingCount++;
      }
    }

    if (pendingCount >= 5) {
      throw new RoomError('RATE_LIMITED', 'Too many pending requests. Limit is 5.');
    }

    const requestId = randomUUID();
    const request = {
      requestId,
      userId,
      username,
      action,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.changeRequests.set(requestId, request);
    this.lastActivityAt = Date.now();
    return request;
  }

  /**
   * Retrieves a change request by its ID.
   * @param {string} requestId
   * @returns {Object | undefined}
   */
  getChangeRequest(requestId) {
    return this.changeRequests.get(requestId);
  }

  /**
   * Resolves a pending change request.
   * @param {string} requestId
   * @param {'approve' | 'reject'} decision
   * @param {{ userId: string, username: string }} resolvedBy
   * @returns {Object}
   */
  resolveChangeRequest(requestId, decision, resolvedBy) {
    const request = this.changeRequests.get(requestId);
    if (!request || request.status !== 'pending') {
      throw new RoomError('REQUEST_NOT_FOUND', 'Request not found or already resolved.');
    }

    if (!this.participants.has(request.userId)) {
      throw new RoomError('REQUEST_NOT_FOUND', 'Requester has left the room or request has expired.');
    }

    request.status = decision === 'approve' ? 'approved' : 'rejected';
    request.resolvedBy = resolvedBy;
    request.resolvedAt = Date.now();
    this.lastActivityAt = Date.now();
    return request;
  }

  /**
   * Returns list of all participants serialized for client view.
   * @returns {Array<{ userId: string, username: string, role: string }>}
   */
  toParticipantDTOs() {
    return Array.from(this.participants.values()).map((p) => p.toDTO());
  }

  /**
   * Returns authoritative playback state DTO.
   * @param {number} [now=Date.now()]
   */
  toSyncState(now = Date.now()) {
    return this.playback.toSyncState(now);
  }
}


/**
 * @file approvalHandler.js
 * Socket.IO handlers for the participant request/approval flow.
 * Source of truth: docs/01-requirements.md FR-11, docs/04-websocket-events.md §6.2, and docs/07-rbac-matrix.md
 */

import { requestChangeSchema, resolveChangeSchema } from '../../schemas/socketSchemas.js';
import { roomManager } from '../../domain/RoomManager.js';
import { PermissionService, PERMISSIONS } from '../../domain/PermissionService.js';
import { saveRoomToDatabase } from '../../services/roomPersistence.js';


/**
 * Attaches request/approval WebSocket event handlers.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerApprovalHandlers(io, socket) {
  /**
   * request_change event (Participant only)
   * Emitted when a participant requests a playback or video change.
   */
  socket.on('request_change', (payload, ack = () => {}) => {
    // 1. Check joined socket
    if (!socket.data?.roomId || !socket.data?.userId) {
      return ack({
        ok: false,
        error: { code: 'NOT_IN_ROOM', message: 'Socket is not in an active room' },
      });
    }

    // 2. Validate payload schema
    const parsed = requestChangeSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.errors[0]?.message || 'Invalid request_change payload',
        },
      });
    }

    // 3. Retrieve room and actor
    const room = roomManager.getRoom(socket.data.roomId);
    if (!room) {
      return ack({
        ok: false,
        error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
      });
    }

    const actor = room.getParticipant(socket.data.userId);
    if (!actor) {
      return ack({
        ok: false,
        error: { code: 'NOT_IN_ROOM', message: 'Actor is no longer active in room' },
      });
    }

    // 4. Permission check (Participant only; Host/Moderator must act directly)
    if (!PermissionService.can(actor.role, PERMISSIONS.REQUEST_CREATE)) {
      return ack({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Hosts and moderators must perform actions directly.',
        },
      });
    }

    // 5. Create change request in room state
    let request;
    try {
      request = room.addChangeRequest({
        userId: actor.userId,
        username: actor.username,
        action: parsed.data.action,
      });
    } catch (err) {
      return ack({
        ok: false,
        error: {
          code: err.code || 'RATE_LIMITED',
          message: err.message,
        },
      });
    }

    // 6. Broadcast change_requested to staff channel only
    io.to(`room:${room.id}:staff`).emit('change_requested', {
      requestId: request.requestId,
      userId: request.userId,
      username: request.username,
      action: request.action,
    });

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 7. Ack with requestId to requester
    ack({
      ok: true,
      requestId: request.requestId,
    });
  });


  /**
   * resolve_change event (Host and Moderator only)
   * Resolves a pending change request with either 'approve' or 'reject'.
   */
  socket.on('resolve_change', (payload, ack = () => {}) => {
    // 1. Check joined socket
    if (!socket.data?.roomId || !socket.data?.userId) {
      return ack({
        ok: false,
        error: { code: 'NOT_IN_ROOM', message: 'Socket is not in an active room' },
      });
    }

    // 2. Validate payload schema
    const parsed = resolveChangeSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.errors[0]?.message || 'Invalid resolve_change payload',
        },
      });
    }

    // 3. Retrieve room and actor
    const room = roomManager.getRoom(socket.data.roomId);
    if (!room) {
      return ack({
        ok: false,
        error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
      });
    }

    const actor = room.getParticipant(socket.data.userId);
    if (!actor) {
      return ack({
        ok: false,
        error: { code: 'NOT_IN_ROOM', message: 'Actor is no longer active in room' },
      });
    }

    // 4. Permission check (Host and Moderator only)
    if (!PermissionService.can(actor.role, PERMISSIONS.REQUEST_RESOLVE)) {
      return ack({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Your role does not allow this action.' },
      });
    }

    const { requestId, decision } = parsed.data;

    // 5. Resolve request in room state
    let request;
    try {
      request = room.resolveChangeRequest(requestId, decision, {
        userId: actor.userId,
        username: actor.username,
      });
    } catch (err) {
      return ack({
        ok: false,
        error: {
          code: err.code || 'REQUEST_NOT_FOUND',
          message: err.message,
        },
      });
    }

    // 6. If approved, re-validate and apply action
    if (decision === 'approve') {
      try {
        if (request.action.type === 'play') {
          if (!room.playback.videoId) {
            return ack({
              ok: false,
              error: { code: 'NO_VIDEO_LOADED', message: 'Cannot play without a video loaded.' },
            });
          }
          room.playback.play();
        } else if (request.action.type === 'pause') {
          room.playback.pause();
        } else if (request.action.type === 'seek') {
          room.playback.seek(request.action.time);
        } else if (request.action.type === 'change_video') {
          room.playback.changeVideo(request.action.videoId);
        }
      } catch (err) {
        return ack({
          ok: false,
          error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
        });
      }

      // Broadcast resolution and updated playback state to entire room
      io.to(`room:${room.id}`).emit('change_resolved', {
        requestId: request.requestId,
        userId: request.userId,
        username: request.username,
        action: request.action,
        decision: 'approved',
        resolvedBy: {
          userId: actor.userId,
          username: actor.username,
        },
      });

      io.to(`room:${room.id}`).emit('sync_state', room.toSyncState());
    } else {
      // If rejected, broadcast rejection without modifying playback
      io.to(`room:${room.id}`).emit('change_resolved', {
        requestId: request.requestId,
        userId: request.userId,
        username: request.username,
        action: request.action,
        decision: 'rejected',
        resolvedBy: {
          userId: actor.userId,
          username: actor.username,
        },
      });
    }

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 7. Ack success to resolving staff
    ack({ ok: true });
  });
}


/**
 * @file playbackHandler.js
 * Socket.IO event controller for synchronized video playback (play, pause, seek, change_video).
 * Enforces the strict 8-step validation order from docs/02 §10 and docs/07 §4.
 * Source of truth: docs/04-websocket-events.md §4.3 to §4.7
 */

import { roomManager } from '../../domain/RoomManager.js';
import { PermissionService, PERMISSIONS } from '../../domain/PermissionService.js';
import {
  playSchema,
  pauseSchema,
  seekSchema,
  changeVideoSchema,
} from '../../schemas/socketSchemas.js';
import { saveRoomToDatabase } from '../../services/roomPersistence.js';


/**
 * Helper to execute the first 4 verification steps common to all playback events:
 * 1. Joined socket?
 * 2. Room exists?
 * 3. Participant active in room?
 * 4. PermissionService check?
 *
 * @param {import('socket.io').Socket} socket
 * @param {string} permission
 * @returns {{ room: import('../../domain/Room.js').Room, participant: import('../../domain/Participant.js').Participant } | { error: { code: string, message: string } }}
 */
function verifyAuthAndMembership(socket, permission) {
  // Step 1: Check if socket has joined a room
  if (!socket.data?.roomId || !socket.data?.userId) {
    return {
      error: {
        code: 'NOT_IN_ROOM',
        message: 'Socket has not joined a room',
      },
    };
  }

  // Step 2 & 3: Check if room and participant exist in memory
  const room = roomManager.getRoom(socket.data.roomId);
  if (!room) {
    return {
      error: {
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found',
      },
    };
  }

  const participant = room.getParticipant(socket.data.userId);
  if (!participant) {
    return {
      error: {
        code: 'NOT_IN_ROOM',
        message: 'Participant is no longer active in this room',
      },
    };
  }

  // Step 4: Validate role permission on server
  if (!PermissionService.can(participant.role, permission)) {
    return {
      error: {
        code: 'FORBIDDEN',
        message: 'Your role does not allow this action.',
      },
    };
  }

  return { room, participant };
}

/**
 * Registers playback event handlers for a connected socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerPlaybackHandlers(io, socket) {
  /**
   * play event
   */
  socket.on('play', (payload, ack = () => {}) => {
    // 1. Validate payload
    const parsed = playSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid payload format' },
      });
    }

    // 2-4. Auth & Membership check
    const auth = verifyAuthAndMembership(socket, PERMISSIONS.PLAYBACK_CONTROL);
    if (auth.error) {
      return ack({ ok: false, error: auth.error });
    }
    const { room } = auth;

    // 5. Domain validation: A video must be loaded before playing
    if (!room.playback.videoId) {
      return ack({
        ok: false,
        error: {
          code: 'NO_VIDEO_LOADED',
          message: 'No video is currently loaded in the room.',
        },
      });
    }

    // 6. Mutate room playback state
    room.playback.play(parsed.data?.currentTime);
    room.lastActivityAt = Date.now();

    // 7. Broadcast sync_state to all room participants
    const syncPayload = room.toSyncState();
    io.to(`room:${room.id}`).emit('sync_state', syncPayload);

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 8. Ack back to sender
    ack({ ok: true, data: syncPayload });
  });


  /**
   * pause event
   */
  socket.on('pause', (payload, ack = () => {}) => {
    // 1. Validate payload
    const parsed = pauseSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid payload format' },
      });
    }

    // 2-4. Auth & Membership check
    const auth = verifyAuthAndMembership(socket, PERMISSIONS.PLAYBACK_CONTROL);
    if (auth.error) {
      return ack({ ok: false, error: auth.error });
    }
    const { room } = auth;

    // 6. Mutate room playback state (pause preserves frozen live time)
    room.playback.pause(parsed.data?.currentTime);
    room.lastActivityAt = Date.now();

    // 7. Broadcast sync_state to room
    const syncPayload = room.toSyncState();
    io.to(`room:${room.id}`).emit('sync_state', syncPayload);

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 8. Ack back to sender
    ack({ ok: true, data: syncPayload });
  });

  /**
   * seek event
   */
  socket.on('seek', (payload, ack = () => {}) => {
    // 1. Validate payload
    const parsed = seekSchema.safeParse(payload);
    if (!parsed.success) {
      const isTimeIssue = parsed.error.issues.some((i) => i.path.includes('time'));
      return ack({
        ok: false,
        error: {
          code: isTimeIssue ? 'INVALID_TIME' : 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid seek time',
        },
      });
    }

    // 2-4. Auth & Membership check
    const auth = verifyAuthAndMembership(socket, PERMISSIONS.PLAYBACK_CONTROL);
    if (auth.error) {
      return ack({ ok: false, error: auth.error });
    }
    const { room } = auth;

    // 5. Domain validation: Must have a video loaded to seek
    if (!room.playback.videoId) {
      return ack({
        ok: false,
        error: {
          code: 'NO_VIDEO_LOADED',
          message: 'No video is currently loaded in the room.',
        },
      });
    }

    // 6. Mutate room playback state
    room.playback.seek(parsed.data.time);
    room.lastActivityAt = Date.now();

    // 7. Broadcast sync_state to room
    const syncPayload = room.toSyncState();
    io.to(`room:${room.id}`).emit('sync_state', syncPayload);

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 8. Ack back to sender
    ack({ ok: true, data: syncPayload });
  });

  /**
   * change_video event
   */
  socket.on('change_video', (payload, ack = () => {}) => {
    // 1. Validate payload
    const parsed = changeVideoSchema.safeParse(payload);
    if (!parsed.success) {
      const isVideoIssue = parsed.error.issues.some((i) => i.path.includes('videoId'));
      return ack({
        ok: false,
        error: {
          code: isVideoIssue ? 'INVALID_VIDEO_ID' : 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid videoId',
        },
      });
    }

    // 2-4. Auth & Membership check
    const auth = verifyAuthAndMembership(socket, PERMISSIONS.VIDEO_CHANGE);
    if (auth.error) {
      return ack({ ok: false, error: auth.error });
    }
    const { room } = auth;

    // 6. Mutate room playback state: resets time to 0, paused (doc 04 §4.7)
    room.playback.changeVideo(parsed.data.videoId);
    room.lastActivityAt = Date.now();

    // 7. Broadcast sync_state to room
    const syncPayload = room.toSyncState();
    io.to(`room:${room.id}`).emit('sync_state', syncPayload);

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 8. Ack back to sender
    ack({ ok: true, data: syncPayload });
  });
}


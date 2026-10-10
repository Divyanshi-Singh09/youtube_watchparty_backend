/**
 * @file roomHandler.js
 * Socket.IO event controller for join_room and leave_room events.
 * Source of truth: docs/04-websocket-events.md §4.1, §4.2, §4.10, §4.11
 */

import { roomManager } from '../../domain/RoomManager.js';
import { Participant } from '../../domain/Participant.js';
import { ROLES } from '../../domain/PermissionService.js';
import { generateSessionToken, hashToken } from '../../utils/token.js';
import { joinRoomSchema, leaveRoomSchema } from '../../schemas/socketSchemas.js';
import { saveRoomToDatabase, restoreRoomFromDatabase } from '../../services/roomPersistence.js';

/**
 * Registers room lifecycle events for a newly connected socket.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerRoomHandlers(io, socket) {
  /**
   * Handles join_room event.
   */
  socket.on('join_room', async (payload, ack = () => {}) => {
    // 1. Validate payload schema
    const parsed = joinRoomSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid payload format',
        },
      });
    }

    const { roomId, username, sessionToken } = parsed.data;

    // 2. Validate room exists in memory, or restore from MongoDB (BON-3)
    let room = roomManager.getRoom(roomId);
    if (!room) {
      room = await restoreRoomFromDatabase(roomId, roomManager);
    }

    if (!room) {
      return ack({
        ok: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found',
        },
      });
    }


    // 3. Check for existing participant via sessionToken (Host creator or reconnect)
    let participant;
    let isReconnect = false;
    let activeToken = sessionToken;

    if (sessionToken) {
      const tokenHash = hashToken(sessionToken);
      const existing = room.findParticipantByTokenHash(tokenHash);
      if (existing) {
        participant = existing;
        isReconnect = true;
      }
    }

    // 4. If not reconnecting, create new Participant
    if (!participant) {
      activeToken = generateSessionToken();
      const tokenHash = hashToken(activeToken);

      participant = new Participant({
        username,
        role: ROLES.PARTICIPANT,
        sessionTokenHash: tokenHash,
      });

      try {
        room.addParticipant(participant);
      } catch (err) {
        return ack({
          ok: false,
          error: {
            code: err.code || 'INVALID_PAYLOAD',
            message: err.message,
          },
        });
      }
    }

    // 5. Update socket tracking & bind socket.data
    participant.socketId = socket.id;
    socket.data.roomId = room.id;
    socket.data.userId = participant.userId;

    // 6. Join Socket.IO room channel
    const socketRoomName = `room:${room.id}`;
    socket.join(socketRoomName);

    if (participant.role === ROLES.HOST || participant.role === ROLES.MODERATOR) {
      socket.join(`${socketRoomName}:staff`);
    }

    // 7. Acknowledge back to joining socket
    ack({
      ok: true,
      data: {
        userId: participant.userId,
        sessionToken: activeToken,
        role: participant.role,
        participants: room.toParticipantDTOs(),
      },
    });

    // 8. Unicast initial sync_state authoritative playback state to joiner ONLY
    socket.emit('sync_state', room.toSyncState());

    // 9. If new user, broadcast user_joined to everyone in the room
    if (!isReconnect) {
      io.to(socketRoomName).emit('user_joined', {
        username: participant.username,
        userId: participant.userId,
        role: participant.role,
        participants: room.toParticipantDTOs(),
      });
    }

    // Persist to MongoDB
    saveRoomToDatabase(room);
  });


  /**
   * Handles leave_room event.
   */
  socket.on('leave_room', (payload, ack = () => {}) => {
    // 1. Verify socket is currently in a room (doc 04 §4.2)
    if (!socket.data?.roomId || !socket.data?.userId) {
      return ack({
        ok: false,
        error: {
          code: 'NOT_IN_ROOM',
          message: 'Socket has not joined a room',
        },
      });
    }

    // 2. Validate payload schema
    const parsed = leaveRoomSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid payload',
        },
      });
    }

    const { roomId } = parsed.data;
    if (socket.data.roomId !== roomId) {
      return ack({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Room ID does not match current joined room',
        },
      });
    }

    const room = roomManager.getRoom(roomId);
    if (!room) {
      return ack({
        ok: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found',
        },
      });
    }

    try {
      const { leaver, promotedHost } = room.handleLeave(socket.data.userId);
      const socketRoomName = `room:${room.id}`;

      // Leave Socket.IO channels
      socket.leave(socketRoomName);
      socket.leave(`${socketRoomName}:staff`);

      // Clear socket session data
      socket.data.roomId = null;
      socket.data.userId = null;

      // If host was auto-promoted, broadcast role_assigned first
      if (promotedHost) {
        io.to(socketRoomName).emit('role_assigned', {
          userId: promotedHost.userId,
          username: promotedHost.username,
          role: promotedHost.role,
          participants: room.toParticipantDTOs(),
        });
      }

      // Broadcast user_left to remaining room participants
      io.to(socketRoomName).emit('user_left', {
        username: leaver.username,
        userId: leaver.userId,
        participants: room.toParticipantDTOs(),
      });

      // Persist to MongoDB
      saveRoomToDatabase(room);

      return ack({ ok: true });

    } catch (err) {
      return ack({
        ok: false,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message,
        },
      });
    }
  });
}

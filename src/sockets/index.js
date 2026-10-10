/**
 * @file index.js
 * Socket.IO lifecycle entry point.
 * Source of truth: docs/02-architecture.md §6 & docs/04-websocket-events.md
 */

import { registerRoomHandlers } from './handlers/roomHandler.js';
import { registerPlaybackHandlers } from './handlers/playbackHandler.js';
import { registerRoleHandlers } from './handlers/roleHandler.js';
import { registerApprovalHandlers } from './handlers/approvalHandler.js';

import { roomManager } from '../domain/RoomManager.js';
import { env } from '../config/env.js';
import { saveRoomToDatabase } from '../services/roomPersistence.js';

/**
 * Attaches real-time WebSocket listeners to the Socket.IO server.
 * @param {import('socket.io').Server} io
 */
export function setupSockets(io) {
  io.on('connection', (socket) => {
    // Initialize socket session storage
    socket.data = {
      roomId: null,
      userId: null,
    };

    // Register room lifecycle handlers (join_room, leave_room)
    registerRoomHandlers(io, socket);

    // Register media playback handlers (play, pause, seek, change_video)
    registerPlaybackHandlers(io, socket);

    // Register role management handlers (assign_role, remove_participant)
    registerRoleHandlers(io, socket);

    // Register participant request & approval handlers (request_change, resolve_change)
    registerApprovalHandlers(io, socket);

    socket.on('disconnect', () => {
      const roomId = socket.data?.roomId;
      const userId = socket.data?.userId;
      if (!roomId || !userId) return;

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const participant = room.getParticipant(userId);
      if (!participant) return;

      // Mark socket disconnected and begin grace countdown
      participant.socketId = null;

      setTimeout(() => {
        // If participant did not reconnect within the grace window
        if (participant.socketId === null && room.getParticipant(userId)) {
          try {
            const { leaver, promotedHost } = room.handleLeave(userId);
            const socketRoomName = `room:${room.id}`;

            if (promotedHost) {
              io.to(socketRoomName).emit('role_assigned', {
                userId: promotedHost.userId,
                username: promotedHost.username,
                role: promotedHost.role,
                participants: room.toParticipantDTOs(),
              });
            }

            io.to(socketRoomName).emit('user_left', {
              username: leaver.username,
              userId: leaver.userId,
              participants: room.toParticipantDTOs(),
            });

            saveRoomToDatabase(room);
          } catch (err) {
            // Ignored
          }
        }
      }, env.DISCONNECT_GRACE_SECONDS * 1000);
    });
  });
}


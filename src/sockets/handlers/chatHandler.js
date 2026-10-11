/**
 * @file chatHandler.js
 * Socket.IO event controller for live room chat messages.
 * Source of truth: docs/04-websocket-events.md §6.4
 */

import { roomManager } from '../../domain/RoomManager.js';
import { chatMessageSchema } from '../../schemas/socketSchemas.js';
import { saveRoomToDatabase } from '../../services/roomPersistence.js';

/**
 * Registers chat message event handlers for a socket connection.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerChatHandlers(io, socket) {
  socket.on('chat_message', (payload, ack = () => {}) => {
    // 1. Validate that the socket has joined a room
    if (!socket.data?.roomId || !socket.data?.userId) {
      return ack({
        ok: false,
        error: {
          code: 'NOT_IN_ROOM',
          message: 'Socket has not joined a room',
        },
      });
    }

    // 2. Validate room exists in memory
    const room = roomManager.getRoom(socket.data.roomId);
    if (!room) {
      return ack({
        ok: false,
        error: {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found',
        },
      });
    }

    // 3. Validate participant is active in room
    const participant = room.getParticipant(socket.data.userId);
    if (!participant) {
      return ack({
        ok: false,
        error: {
          code: 'NOT_IN_ROOM',
          message: 'Participant not found in room',
        },
      });
    }

    // 4. Validate payload schema
    const parsed = chatMessageSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid payload format',
        },
      });
    }

    // 5. Enforce sliding-window rate limit: 5 messages per 10 seconds per socket
    const now = Date.now();
    if (!socket.data.chatTimestamps) {
      socket.data.chatTimestamps = [];
    }
    socket.data.chatTimestamps = socket.data.chatTimestamps.filter((t) => now - t < 10000);

    if (socket.data.chatTimestamps.length >= 5) {
      return ack({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many messages. Limit is 5 messages per 10 seconds.',
        },
      });
    }

    socket.data.chatTimestamps.push(now);

    // 6. Append message to room history
    const messageRecord = room.addMessage({
      userId: participant.userId,
      username: participant.username,
      role: participant.role,
      message: parsed.data.message,
    });

    // 7. Broadcast chat_message event to all participants in the room
    io.to(`room:${room.id}`).emit('chat_message', messageRecord);

    // 8. Asynchronously sync room state to MongoDB
    saveRoomToDatabase(room);

    // 9. Acknowledge success back to the sender
    return ack({
      ok: true,
      data: messageRecord,
    });
  });
}

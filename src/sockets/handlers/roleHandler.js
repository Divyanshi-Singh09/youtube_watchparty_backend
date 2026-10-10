/**
 * @file roleHandler.js
 * Socket.IO event controller for assign_role and remove_participant.
 * Enforces Host-only role management rules from docs/04 §4.8, §4.9 and docs/07 §3, §4.
 */

import { roomManager } from '../../domain/RoomManager.js';
import { PermissionService, PERMISSIONS, ROLES } from '../../domain/PermissionService.js';
import { assignRoleSchema, removeParticipantSchema } from '../../schemas/socketSchemas.js';
import { saveRoomToDatabase } from '../../services/roomPersistence.js';


/**
 * Registers role management event handlers.
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerRoleHandlers(io, socket) {
  /**
   * assign_role event (Host only)
   */
  socket.on('assign_role', (payload, ack = () => {}) => {
    // 1. Check joined socket
    if (!socket.data?.roomId || !socket.data?.userId) {
      return ack({
        ok: false,
        error: { code: 'NOT_IN_ROOM', message: 'Socket has not joined a room' },
      });
    }

    // 2. Validate payload schema
    const parsed = assignRoleSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Invalid payload' },
      });
    }

    const { userId: targetUserId, role: newRole } = parsed.data;

    // 3. Resolve room and actor from server memory
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

    // 4. Permission check (Host only)
    if (!PermissionService.can(actor.role, PERMISSIONS.ROLE_ASSIGN)) {
      return ack({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Your role does not allow this action.' },
      });
    }

    // 5. Domain validations
    // Cannot target self
    if (targetUserId === actor.userId) {
      return ack({
        ok: false,
        error: { code: 'INVALID_TARGET', message: 'Cannot assign role to yourself' },
      });
    }

    // Only moderator or participant can be assigned via this event
    if (newRole !== ROLES.MODERATOR && newRole !== ROLES.PARTICIPANT) {
      return ack({
        ok: false,
        error: { code: 'INVALID_ROLE', message: 'Invalid role. Only moderator or participant may be assigned.' },
      });
    }

    // Target must exist in the room
    const target = room.getParticipant(targetUserId);
    if (!target) {
      return ack({
        ok: false,
        error: { code: 'TARGET_NOT_FOUND', message: 'Target participant not found in room' },
      });
    }

    // Cannot reassign host
    if (target.role === ROLES.HOST) {
      return ack({
        ok: false,
        error: { code: 'INVALID_TARGET', message: 'Cannot reassign role of room host' },
      });
    }

    // 6. Mutate role state
    const roleChanged = target.role !== newRole;
    target.role = newRole;
    room.lastActivityAt = Date.now();

    // Update staff channel membership for target socket
    if (target.socketId) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        if (newRole === ROLES.MODERATOR) {
          targetSocket.join(`room:${room.id}:staff`);
        } else {
          targetSocket.leave(`room:${room.id}:staff`);
        }
      }
    }

    // 7. Broadcast role_assigned to all clients in the room (if changed)
    if (roleChanged) {
      io.to(`room:${room.id}`).emit('role_assigned', {
        userId: target.userId,
        username: target.username,
        role: target.role,
        participants: room.toParticipantDTOs(),
      });
    }

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 8. Ack back to Host
    ack({ ok: true });
  });


  /**
   * remove_participant event (Host only)
   */
  socket.on('remove_participant', (payload, ack = () => {}) => {
    // 1. Check joined socket
    if (!socket.data?.roomId || !socket.data?.userId) {
      return ack({
        ok: false,
        error: { code: 'NOT_IN_ROOM', message: 'Socket has not joined a room' },
      });
    }

    // 2. Validate payload schema
    const parsed = removeParticipantSchema.safeParse(payload);
    if (!parsed.success) {
      return ack({
        ok: false,
        error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Invalid payload' },
      });
    }

    const { userId: targetUserId } = parsed.data;

    // 3. Resolve room and actor
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

    // 4. Permission check (Host only)
    if (!PermissionService.can(actor.role, PERMISSIONS.PARTICIPANT_REMOVE)) {
      return ack({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Your role does not allow this action.' },
      });
    }

    // 5. Domain validations
    // Cannot remove self
    if (targetUserId === actor.userId) {
      return ack({
        ok: false,
        error: { code: 'INVALID_TARGET', message: 'The host cannot be removed from the room.' },
      });
    }

    const target = room.getParticipant(targetUserId);
    if (!target) {
      return ack({
        ok: false,
        error: { code: 'TARGET_NOT_FOUND', message: 'Target participant not found in room' },
      });
    }

    if (target.role === ROLES.HOST) {
      return ack({
        ok: false,
        error: { code: 'INVALID_TARGET', message: 'The host cannot be removed from the room.' },
      });
    }

    // 6. Mutate: Remove participant from domain
    room.removeParticipant(targetUserId);

    // 7. Broadcast participant_removed to room (including target socket before disconnecting)
    const socketRoomName = `room:${room.id}`;
    io.to(socketRoomName).emit('participant_removed', {
      userId: target.userId,
      participants: room.toParticipantDTOs(),
    });

    // Clean up target socket membership and credentials
    if (target.socketId) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.leave(socketRoomName);
        targetSocket.leave(`${socketRoomName}:staff`);
        targetSocket.data.roomId = null;
        targetSocket.data.userId = null;
      }
    }

    // Persist to MongoDB
    saveRoomToDatabase(room);

    // 8. Ack back to Host
    ack({ ok: true });
  });
}


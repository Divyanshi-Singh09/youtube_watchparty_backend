/**
 * @file roomsController.js
 * Controller handling REST room creation and room status checks.
 * Source of truth: docs/05-api-documentation.md §3
 */

import { roomManager } from '../../domain/RoomManager.js';
import { createRoomSchema, roomIdParamSchema } from '../../schemas/roomSchemas.js';
import { env } from '../../config/env.js';
import { saveRoomToDatabase, restoreRoomFromDatabase } from '../../services/roomPersistence.js';

/**
 * Handles POST /api/rooms (Room creation by Host).
 */
export async function createRoom(req, res) {
  // Validate request body with Zod
  const parseResult = createRoomSchema.safeParse(req.body);

  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const isVideoError = firstIssue?.path?.includes('videoId');
    return res.status(400).json({
      error: {
        code: isVideoError ? 'INVALID_VIDEO_ID' : 'INVALID_PAYLOAD',
        message: firstIssue?.message || 'Invalid payload',
        details: parseResult.error.issues.map((i) => ({
          path: i.path.join('.'),
          issue: i.message,
        })),
      },
    });
  }

  const { username, videoId } = parseResult.data;

  try {
    const { room, host, sessionToken } = roomManager.createRoom({
      username,
      videoId,
    });

    // Asynchronously persist to MongoDB
    saveRoomToDatabase(room);

    return res.status(201).json({
      roomId: room.id,
      userId: host.userId,
      sessionToken,
      role: host.role,
      shareUrl: `${env.CLIENT_URL}/room/${room.id}`,
    });

  } catch (error) {
    console.error('Error creating room:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create room.',
      },
    });
  }
}

/**
 * Handles GET /api/rooms/:roomId (Room existence & metadata check).
 */
export async function getRoom(req, res) {
  const paramResult = roomIdParamSchema.safeParse(req.params);

  if (!paramResult.success) {
    return res.status(400).json({
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid room ID format.',
      },
    });
  }

  const { roomId } = paramResult.data;
  let room = roomManager.getRoom(roomId);

  if (!room) {
    room = await restoreRoomFromDatabase(roomId, roomManager);
  }

  if (!room) {
    return res.status(404).json({
      error: {
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found',
      },
    });
  }


  return res.status(200).json({
    roomId: room.id,
    participantCount: room.participantCount,
    hasVideo: room.playback.videoId !== null,
    isFull: room.participantCount >= room.maxParticipants,
    createdAt: new Date(room.createdAt).toISOString(),
  });
}

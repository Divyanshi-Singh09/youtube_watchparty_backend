/**
 * @file roomPersistence.js
 * Asynchronous MongoDB sync service for watch party rooms.
 * Bridges in-memory domain models with persistent MongoDB database storage.
 * Source of truth: docs/03-database-schema.md §3 & §4 (BON-3)
 */

import { RoomModel } from '../models/RoomModel.js';
import { isDatabaseConnected } from '../config/database.js';
import { Room } from '../domain/Room.js';
import { Participant } from '../domain/Participant.js';

/**
 * Saves current room state to MongoDB.
 * Non-blocking, fails gracefully if database is unreachable.
 * @param {Room} room
 */
export async function saveRoomToDatabase(room) {
  if (!isDatabaseConnected() || !room) return;

  try {
    const participantsList = Array.from(room.participants.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      role: p.role,
      sessionTokenHash: p.sessionTokenHash,
      joinedAt: p.joinedAt,
    }));

    const changeRequestsList = Array.from(room.changeRequests?.values() || []).map((r) => ({
      requestId: r.requestId,
      userId: r.userId,
      username: r.username,
      action: r.action,
      status: r.status,
      createdAt: r.createdAt,
    }));

    const messagesList = (room.getRecentMessages ? room.getRecentMessages() : room.messages || []).slice(-100);

    await RoomModel.findOneAndUpdate(
      { roomId: room.id },
      {
        roomId: room.id,
        initialVideoId: room.playback.videoId,
        playbackState: {
          videoId: room.playback.videoId,
          playState: room.playback.playState,
          currentTime: room.playback.currentTime,
          updatedAt: room.playback.updatedAt,
        },
        participants: participantsList,
        changeRequests: changeRequestsList,
        messages: messagesList,
        maxParticipants: room.maxParticipants,
        lastActivityAt: room.lastActivityAt,
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error(`[roomPersistence] Failed to sync room ${room.id} to MongoDB:`, err.message);
  }
}

/**
 * Attempts to restore an archived room from MongoDB back into in-memory RoomManager.
 * @param {string} roomId
 * @param {import('../domain/RoomManager.js').RoomManager} roomManager
 * @returns {Promise<Room | null>}
 */
export async function restoreRoomFromDatabase(roomId, roomManager) {
  if (!isDatabaseConnected() || !roomId) return null;

  try {
    const doc = await RoomModel.findOne({ roomId: roomId.toUpperCase().trim() }).lean();
    if (!doc) return null;

    const room = new Room({
      id: doc.roomId,
      initialVideoId: doc.playbackState?.videoId || doc.initialVideoId,
      maxParticipants: doc.maxParticipants || 50,
    });

    if (doc.playbackState) {
      room.playback.videoId = doc.playbackState.videoId || null;
      room.playback.playState = doc.playbackState.playState || 'paused';
      room.playback.currentTime = doc.playbackState.currentTime || 0;
      room.playback.updatedAt = doc.playbackState.updatedAt || Date.now();
    }

    if (Array.isArray(doc.participants)) {
      for (const p of doc.participants) {
        const participant = new Participant({
          userId: p.userId,
          username: p.username,
          role: p.role,
          sessionTokenHash: p.sessionTokenHash,
          joinedAt: p.joinedAt,
        });
        room.participants.set(participant.userId, participant);
      }
    }

    if (Array.isArray(doc.changeRequests)) {
      for (const cr of doc.changeRequests) {
        room.changeRequests.set(cr.requestId, {
          requestId: cr.requestId,
          userId: cr.userId,
          username: cr.username,
          action: cr.action,
          status: cr.status,
          createdAt: cr.createdAt,
        });
      }
    }

    if (Array.isArray(doc.messages)) {
      room.messages = doc.messages.map((m) => ({
        messageId: m.messageId,
        userId: m.userId,
        username: m.username,
        role: m.role,
        message: m.message,
        sentAt: m.sentAt,
      }));
    }

    roomManager.rooms.set(room.id, room);
    console.log(`[roomPersistence] Restored room ${room.id} from MongoDB into memory.`);
    return room;
  } catch (err) {
    console.error(`[roomPersistence] Error restoring room ${roomId} from MongoDB:`, err.message);
    return null;
  }
}

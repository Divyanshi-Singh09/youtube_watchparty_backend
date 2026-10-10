/**
 * @file RoomModel.js
 * Mongoose model for persistent rooms and party history.
 * Source of truth: docs/03-database-schema.md
 */

import mongoose from 'mongoose';

const ParticipantSubSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
    role: {
      type: String,
      enum: ['host', 'moderator', 'participant'],
      default: 'participant',
    },
    sessionTokenHash: { type: String, required: true },
    joinedAt: { type: Number, default: Date.now },
  },
  { _id: false }
);

const PlaybackSubSchema = new mongoose.Schema(
  {
    videoId: { type: String, default: null },
    playState: {
      type: String,
      enum: ['playing', 'paused'],
      default: 'paused',
    },
    currentTime: { type: Number, default: 0 },
    updatedAt: { type: Number, default: Date.now },
  },
  { _id: false }
);

const ChangeRequestSubSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    action: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    createdAt: { type: Number, default: Date.now },
  },
  { _id: false }
);

const RoomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    initialVideoId: { type: String, default: null },
    playbackState: { type: PlaybackSubSchema, default: () => ({}) },
    participants: { type: [ParticipantSubSchema], default: [] },
    changeRequests: { type: [ChangeRequestSubSchema], default: [] },
    maxParticipants: { type: Number, default: 50 },
    lastActivityAt: { type: Number, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'rooms',
  }
);

export const RoomModel = mongoose.models.Room || mongoose.model('Room', RoomSchema);

/**
 * @file socketSchemas.js
 * Zod validation schemas for incoming WebSocket events.
 * Source of truth: docs/04-websocket-events.md §1 & §4
 */

import { z } from 'zod';
import { ROOM_CODE_REGEX, YOUTUBE_ID_REGEX } from './roomSchemas.js';

export const joinRoomSchema = z.object({
  roomId: z
    .string({ required_error: 'roomId is required' })
    .regex(ROOM_CODE_REGEX, { message: 'roomId must be an 8-character room code' })
    .transform((val) => val.toUpperCase()),
  username: z
    .string({ required_error: 'username is required' })
    .trim()
    .min(1, { message: 'username must be 1-30 characters' })
    .max(30, { message: 'username must be 1-30 characters' }),
  sessionToken: z
    .string()
    .length(64, { message: 'sessionToken must be a 64-character hex string' })
    .optional(),
});

export const leaveRoomSchema = z.object({
  roomId: z
    .string({ required_error: 'roomId is required' })
    .regex(ROOM_CODE_REGEX, { message: 'roomId must be an 8-character room code' })
    .transform((val) => val.toUpperCase()),
});

// Play event payload: {} (PDF) or optional { currentTime?: number } (Recommended)
export const playSchema = z
  .object({
    currentTime: z.number().finite().nonnegative({ message: 'currentTime must be >= 0' }).optional(),
  })
  .optional()
  .default({});

// Pause event payload: {} (PDF) or optional { currentTime?: number } (Recommended)
export const pauseSchema = z
  .object({
    currentTime: z.number().finite().nonnegative({ message: 'currentTime must be >= 0' }).optional(),
  })
  .optional()
  .default({});

// Seek event payload: { time: number } (PDF)
export const seekSchema = z.object({
  time: z
    .number({
      required_error: 'time is required',
      invalid_type_error: 'time must be a number',
    })
    .finite({ message: 'time must be a finite number' })
    .nonnegative({ message: 'time must be >= 0' }),
});

// Change video event payload: { videoId: string } (PDF)
export const changeVideoSchema = z.object({
  videoId: z
    .string({
      required_error: 'videoId is required',
      invalid_type_error: 'videoId must be a string',
    })
    .regex(YOUTUBE_ID_REGEX, { message: 'videoId must be an 11-character YouTube video ID' }),
});

// Assign role event payload: { userId: string, role: string } (PDF)
export const assignRoleSchema = z.object({
  userId: z
    .string({
      required_error: 'userId is required',
      invalid_type_error: 'userId must be a string',
    })
    .min(1, { message: 'userId is required' }),
  role: z
    .string({
      required_error: 'role is required',
      invalid_type_error: 'role must be a string',
    })
    .min(1, { message: 'role is required' }),
});

// Remove participant event payload: { userId: string } (PDF)
export const removeParticipantSchema = z.object({
  userId: z
    .string({
      required_error: 'userId is required',
      invalid_type_error: 'userId must be a string',
    })
    .min(1, { message: 'userId is required' }),
});

// Discriminated union of allowable change request actions (docs/04 §6.2)
export const changeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('play'),
  }),
  z.object({
    type: z.literal('pause'),
  }),
  z.object({
    type: z.literal('seek'),
    time: z
      .number({
        required_error: 'time is required',
        invalid_type_error: 'time must be a number',
      })
      .finite({ message: 'time must be a finite number' })
      .nonnegative({ message: 'time must be >= 0' }),
  }),
  z.object({
    type: z.literal('change_video'),
    videoId: z
      .string({
        required_error: 'videoId is required',
        invalid_type_error: 'videoId must be a string',
      })
      .regex(YOUTUBE_ID_REGEX, { message: 'videoId must be an 11-character YouTube video ID' }),
  }),
]);

// Participant requests a playback/video change (FR-11 interpretation)
export const requestChangeSchema = z.object({
  action: changeActionSchema,
});

// Staff resolves a pending change request
export const resolveChangeSchema = z.object({
  requestId: z
    .string({
      required_error: 'requestId is required',
      invalid_type_error: 'requestId must be a string',
    })
    .min(1, { message: 'requestId is required' }),
  decision: z.enum(['approve', 'reject'], {
    errorMap: () => ({ message: "decision must be 'approve' or 'reject'" }),
  }),
});

// Chat message event payload: { message: string } (docs/04 §6.4)
export const chatMessageSchema = z.object({
  message: z
    .string({
      required_error: 'message is required',
      invalid_type_error: 'message must be a string',
    })
    .trim()
    .min(1, { message: 'message must be between 1 and 500 characters' })
    .max(500, { message: 'message must be between 1 and 500 characters' }),
});



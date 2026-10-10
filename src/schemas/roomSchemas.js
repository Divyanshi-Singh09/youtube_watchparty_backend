/**
 * @file roomSchemas.js
 * Zod validation schemas for room endpoints and parameters.
 * Source of truth: docs/04-websocket-events.md §1 & docs/05-api-documentation.md
 */

import { z } from 'zod';

export const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
export const ROOM_CODE_REGEX = /^[A-HJ-NP-Z2-9]{8}$/i;

export const createRoomSchema = z.object({
  username: z
    .string({
      required_error: 'username is required',
      invalid_type_error: 'username must be a string',
    })
    .trim()
    .min(1, { message: 'username must be 1-30 characters' })
    .max(30, { message: 'username must be 1-30 characters' }),
  videoId: z
    .string()
    .regex(YOUTUBE_ID_REGEX, { message: 'videoId must be an 11-character YouTube video ID' })
    .optional(),
});

export const roomIdParamSchema = z.object({
  roomId: z
    .string()
    .regex(ROOM_CODE_REGEX, { message: 'roomId must be an 8-character room code' })
    .transform((val) => val.toUpperCase()),
});

/**
 * @file rooms.js
 * Express router for room creation and room information endpoints.
 * Source of truth: docs/05-api-documentation.md
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createRoom, getRoom } from '../controllers/roomsController.js';

const router = Router();

// Rate limiter for room creation: 10 requests per minute per IP (doc 05 §2)
const createRoomLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many rooms created from this IP, please try again in a minute.',
    },
  },
});

router.post('/', createRoomLimiter, createRoom);
router.get('/:roomId', getRoom);

export default router;

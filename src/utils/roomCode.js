/**
 * @file roomCode.js
 * Generates unambiguous 8-character room codes.
 * Source of truth: docs/02-architecture.md §7 and docs/04-websocket-events.md §1
 */

import crypto from 'node:crypto';

// Unambiguous 32-character alphabet (excludes 0, O, 1, I to prevent user confusion)
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/**
 * Generates a cryptographically secure 8-character room code.
 * @returns {string} 8-character uppercase room code
 */
export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = crypto.randomInt(0, ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[randomIndex];
  }
  return code;
}

/**
 * Validates whether a room code matches the required 8-character alphabet format.
 * @param {string} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  if (typeof code !== 'string') return false;
  const regex = /^[A-HJ-NP-Z2-9]{8}$/i;
  return regex.test(code.trim());
}

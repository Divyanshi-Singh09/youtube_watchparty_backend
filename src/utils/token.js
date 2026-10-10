/**
 * @file token.js
 * Cryptographic session token generation and SHA-256 hashing.
 * Source of truth: docs/02-architecture.md §14
 */

import crypto from 'node:crypto';

/**
 * Generates a cryptographically strong 256-bit session token (64 hex chars).
 * @returns {string} Plaintext token to return to the client
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes a SHA-256 hash of a session token for secure server-side storage.
 * @param {string} token - The raw session token
 * @returns {string} 64-character SHA-256 hex digest
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

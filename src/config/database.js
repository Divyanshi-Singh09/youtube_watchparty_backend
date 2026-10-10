/**
 * @file database.js
 * MongoDB connection lifecycle manager via Mongoose.
 * Supports graceful fallback if offline or during unit tests.
 */

import mongoose from 'mongoose';
import { env } from './env.js';

let isConnected = false;

export async function connectDatabase() {
  if (!env.MONGODB_URI) {
    console.warn('⚠️  MONGODB_URI not configured; running in in-memory mode only.');
    return false;
  }

  if (isConnected) {
    return true;
  }

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log('✅ Connected to MongoDB Atlas successfully.');
    return true;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    // Don't crash the server so real-time memory fallback continues working
    return false;
  }
}

export function isDatabaseConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function disconnectDatabase() {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

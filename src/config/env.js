import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  MAX_PARTICIPANTS_PER_ROOM: z.coerce.number().default(50),
  EMPTY_ROOM_TTL_MINUTES: z.coerce.number().default(30),
  DISCONNECT_GRACE_SECONDS: z.coerce.number().default(30),
  MONGODB_URI: z.string().optional(),
});


const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

/**
 * Validated environment configuration object.
 */
export const env = parsed.data;

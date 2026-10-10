import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import roomsRouter from './http/routes/rooms.js';

const app = express();

// Security headers with Helmet
app.use(helmet());

// Parse allowed CORS origins from CLIENT_URL (supports comma-separated list)
const allowedOrigins = env.CLIENT_URL.split(',').map((url) => url.trim());

// Configure CORS for Express REST routes
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, server-to-server, or same-origin)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

// Built-in JSON body parser middleware
app.use(express.json());

// Liveness health check endpoint (as specified in docs/05-api-documentation.md §3.1)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Mount room REST routes
app.use('/api/rooms', roomsRouter);

export { app, allowedOrigins };

import http from 'node:http';
import { Server } from 'socket.io';
import { app, allowedOrigins } from './app.js';
import { env } from './config/env.js';
import { setupSockets } from './sockets/index.js';
import { connectDatabase } from './config/database.js';

// Create a Node.js native HTTP server wrapping Express
const server = http.createServer(app);

// Attach Socket.IO to the same HTTP server with identical CORS rules
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow connections with no origin header or matching CLIENT_URL
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by Socket.IO CORS`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Register all WebSocket event listeners
setupSockets(io);

// Start listening on the configured PORT immediately
server.listen(env.PORT, () => {
  console.log(`🚀 Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
  console.log(`🌐 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
});

// Connect to MongoDB in the background without blocking server availability
connectDatabase().catch((err) => {
  console.error('Initial MongoDB connection attempt error:', err?.message || err);
});


export { server, io };

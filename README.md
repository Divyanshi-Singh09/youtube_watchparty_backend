# 🖥️ WatchParty Backend Engine

The real-time synchronization backend for the YouTube WatchParty application, powered by **Node.js**, **Express 5**, **Socket.IO 4**, and **MongoDB Atlas**.

---

## 📑 Table of Contents
1. [Architecture Overview](#-architecture-overview)
2. [Key Features & Mechanics](#-key-features--mechanics)
3. [Directory Structure](#-directory-structure)
4. [Prerequisites & Environment Variables](#-prerequisites--environment-variables)
5. [Installation & Running](#-installation--running)
6. [REST API Endpoints](#-rest-api-endpoints)
7. [WebSocket Event Reference](#-websocket-event-reference)
8. [Automated Testing Suite (85 Tests)](#-automated-testing-suite-85-tests)
9. [Security, Rate Limiting & Validation](#-security-rate-limiting--validation)

---

## 🏛️ Architecture Overview

The backend uses a layered architecture separating pure business domain models, network protocols (HTTP & WebSockets), and persistent storage:

```
                  ┌──────────────────────────────────────────────┐
                  │          Inbound Client Connections          │
                  │        HTTP REST + WebSocket (Socket.IO)     │
                  └──────────────┬───────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       ┌──────────────────┐            ┌──────────────────┐
       │   HTTP Routes    │            │ Socket Handlers  │
       │   /api/rooms     │            │ room, playback,  │
       │   /api/health    │            │ role, chat, etc. │
       └─────────┬────────┘            └─────────┬────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                     ┌───────────────────────┐
                     │   Zod Schemas Layer   │ (Validates all payloads)
                     └───────────┬───────────┘
                                 ▼
                     ┌───────────────────────┐
                     │   Pure Domain Layer   │
                     │  Room, Participant,   │
                     │  PlaybackState, RBAC  │
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
      ┌─────────────────────┐        ┌──────────────────────┐
      │     RoomManager     │        │  RoomPersistence     │
      │ Sub-ms in-memory Map│ ◄────► │  Mongoose / MongoDB  │
      └─────────────────────┘        └──────────────────────┘
```

---

## ⚡ Key Features & Mechanics

### 1. Mathematical Anchor Model (Sub-100ms Drift)
Instead of streaming 1-second ticks that congest network bandwidth, the server records an authoritative playback anchor:
$$\text{liveTime}(t) = \text{currentTime} + \frac{t - \text{updatedAt}}{1000} \quad (\text{when playing})$$
When paused, $\text{liveTime}(t) = \text{currentTime}$.

### 2. Pure Domain Separation
- **`Room.js`**: Core room entity managing participants, playback state, change requests, and chat history.
- **`PlaybackState.js`**: Pure state machine managing `play`, `pause`, `seek`, and `change_video` invariants.
- **`Participant.js`**: Value object encapsulating user identity, roles, joined timestamps, and hashed session tokens.
- **`PermissionService.js`**: Role-Based Access Control matrix (`host`, `moderator`, `participant`).

### 3. Hybrid In-Memory + MongoDB Atlas Persistence (BON-3)
- Active watch parties execute with zero database latency inside the in-memory `RoomManager`.
- Background persistence (`roomPersistence.js`) writes state snapshots (participants, playback anchor, change requests, and recent chat history) to MongoDB Atlas.
- If a server restarts or a participant joins an inactive room, state is seamlessly restored from MongoDB.

### 4. Disconnect Grace Period & Secure Reconnection
- Disconnecting sockets receive a **30-second grace window** before removal.
- On reconnect, clients supply their 256-bit `sessionToken`. The server hashes this token (`SHA-256`) and restores the exact participant identity and role.

---

## 📁 Directory Structure

```text
backend/
├── src/
│   ├── config/
│   │   ├── database.js          # MongoDB Atlas Mongoose connection & lifecycle
│   │   └── env.js               # Environment variable parsing & validation
│   ├── domain/                  # Pure Domain Layer (zero framework dependencies)
│   │   ├── Participant.js       # Participant model & DTO serializer
│   │   ├── PermissionService.js # RBAC permissions matrix
│   │   ├── PlaybackState.js     # Mathematical anchor state machine
│   │   ├── Room.js              # Watch party aggregate root model
│   │   └── RoomManager.js       # In-memory room repository
│   ├── http/
│   │   ├── controllers/         # Express controllers (roomController)
│   │   ├── middleware/          # Rate limiting & validation middleware
│   │   └── routes/              # Express route declarations (roomRoutes, healthRoutes)
│   ├── models/
│   │   └── RoomModel.js         # Mongoose schema for MongoDB Atlas
│   ├── schemas/
│   │   ├── roomSchemas.js       # Zod schemas for REST API
│   │   └── socketSchemas.js     # Zod schemas for all WebSocket events
│   ├── services/
│   │   └── roomPersistence.js   # Async MongoDB Atlas sync & restore service
│   ├── sockets/
│   │   ├── handlers/
│   │   │   ├── approvalHandler.js # Participant change request & staff approval flow
│   │   │   ├── chatHandler.js     # Live room chat with rate limiting
│   │   │   ├── playbackHandler.js # Play, pause, seek, and change_video handlers
│   │   │   ├── roleHandler.js     # Role assignment & participant removal (kick)
│   │   │   └── roomHandler.js     # join_room and leave_room handlers
│   │   └── index.js             # Socket.IO connection & registration hub
│   ├── utils/
│   │   ├── roomCode.js          # Unambiguous 8-character room code generator
│   │   ├── token.js             # Crypto session token generator & SHA-256 hasher
│   │   └── youtube.js           # YouTube URL & 11-char video ID parser
│   ├── app.js                   # Express application setup
│   └── index.js                 # HTTP + WebSocket server startup
├── tests/                       # 85 Vitest integration & unit tests
├── .env                         # Local environment variables
└── package.json                 # Project dependencies & scripts
```

---

## ⚙️ Prerequisites & Environment Variables

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **npm**: `v9.0.0` or higher
- **MongoDB Atlas** database connection URI

### `.env` Configuration
Create or configure `.env` in the `backend/` directory:

```env
# Server Port
PORT=4000

# Environment Mode ('development' | 'production')
NODE_ENV=development

# Allowed CORS client origin
CLIENT_URL=http://localhost:5173

# Room Capacity Limits
MAX_PARTICIPANTS_PER_ROOM=50

# Time-To-Live for inactive rooms (minutes)
EMPTY_ROOM_TTL_MINUTES=30

# Grace window for disconnected participants (seconds)
DISCONNECT_GRACE_SECONDS=30

# MongoDB Atlas Connection URI
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.dyhocgi.mongodb.net/watchparty?retryWrites=true&w=majority
```

---

## 🚀 Installation & Running

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start Development Server (with hot reloading)
```bash
npm run dev
```
*Server starts on `http://localhost:4000`.*

### 3. Start Production Server
```bash
npm start
```

---

## 🌐 REST API Endpoints

### 1. Healthcheck
- **Endpoint**: `GET /api/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": 1718000000000,
    "database": "connected",
    "activeRooms": 3
  }
  ```

### 2. Create Watch Party Room
- **Endpoint**: `POST /api/rooms`
- **Rate Limit**: 10 room creations per 15 minutes per IP.
- **Request Body**:
  ```json
  {
    "username": "Alex",
    "initialVideoId": "dQw4w9WgXcQ"
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "roomId": "8K2YTX9A",
    "userId": "d748f3e2-...",
    "sessionToken": "a6b98e1f...",
    "role": "host"
  }
  ```

### 3. Get Room Metadata
- **Endpoint**: `GET /api/rooms/:roomId`
- **Response** (`200 OK`):
  ```json
  {
    "roomId": "8K2YTX9A",
    "participantCount": 2,
    "hasVideo": true,
    "isFull": false,
    "createdAt": "2026-10-11T11:00:00.000Z"
  }
  ```

---

## 🔌 WebSocket Event Reference

All socket events accept an optional **acknowledgement callback** `ack({ ok, data, error })`.

| Event | Direction | Payload | Role | Description |
|---|---|---|---|---|
| `join_room` | C → S | `{ roomId, username, sessionToken? }` | Anyone | Enters room; returns `{ userId, role, sessionToken, participants, messages }`. |
| `leave_room` | C → S | `{ roomId }` | Joined user | Explicitly departs the room. |
| `sync_state` | S → C | `{ playState, currentTime, videoId, updatedAt }` | – | Authoritative playback state broadcast. |
| `play` | C → S | `{ currentTime? }` | Host / Moderator | Resumes synchronized video playback. |
| `pause` | C → S | `{ currentTime? }` | Host / Moderator | Pauses synchronized video playback. |
| `seek` | C → S | `{ time }` | Host / Moderator | Seeks timeline to specified timestamp. |
| `change_video` | C → S | `{ videoId }` | Host / Moderator | Loads a new 11-char YouTube video ID. |
| `chat_message` | C → S | `{ message }` | Joined user | Sends text message (1–500 chars; rate-limited). |
| `chat_message` | S → Room | `{ messageId, userId, username, role, message, sentAt }` | – | Broadcasts message to all clients in `room:<id>`. |
| `request_change` | C → S | `{ action: { type, ... } }` | Participant | Submits playback change request (max 5 pending). |
| `change_requested` | S → Staff | `{ requestId, userId, username, action }` | – | Emitted strictly to staff channel (`:staff`). |
| `resolve_change` | C → S | `{ requestId, decision: 'approve' \| 'reject' }` | Host / Moderator | Resolves pending change request. |
| `change_resolved` | S → Room | `{ requestId, decision, resolvedBy, action }` | – | Broadcasts decision outcome to room. |
| `assign_role` | C → S | `{ userId, role: 'moderator' \| 'participant' }` | Host only | Reassigns participant role. |
| `remove_participant`| C → S | `{ userId }` | Host only | Kicks participant from the room. |
| `user_joined` | S → Room | `{ userId, username, role, participants }` | – | Emitted when a new user enters. |
| `user_left` | S → Room | `{ userId, username, participants }` | – | Emitted when a user leaves or disconnect grace expires. |

---

## 🧪 Automated Testing Suite (85 Tests)

The backend features a comprehensive test suite written with **Vitest**, **Supertest**, and `socket.io-client`.

### Running Tests
```bash
cd backend
npm test
```

### Test Coverage Summary:
- `tests/health.test.js` (1 test): Express health checks and security headers.
- `tests/routes/rooms.test.js` (7 tests): Room creation, 8-character room codes, REST validation, metadata retrieval, IP rate limits.
- `tests/domain/permissionService.test.js` (24 tests): Complete verification of Host, Moderator, and Participant RBAC permissions matrix.
- `tests/domain/playbackState.test.js` (8 tests): Mathematical anchor model calculations, drift detection, state transitions.
- `tests/domain/persistence.test.js` (1 test): Live MongoDB Atlas document synchronization and memory restoration.
- `tests/sockets/room.test.js` (6 tests): Socket connection lifecycle, token authentication, participant DTOs, room departure.
- `tests/sockets/playback.test.js` (10 tests): Play, pause, seek, video changes, state broadcasts, permission checks.
- `tests/sockets/role.test.js` (11 tests): Host promotions/demotions, participant removal, host invariant protections.
- `tests/sockets/approval.test.js` (6 tests): Participant request submission, staff-only channel routing, approvals, rejections, rate limits.
- `tests/sockets/chat.test.js` (4 tests): Room message broadcasting, payload constraints, rate limiting, and join history restoration.
- `tests/utils/youtube.test.js` (7 tests): Parsing edge cases for YouTube URLs and video IDs.

**Result**: **11 passed test suites (85 / 85 tests passing)**.

---

## 🛡️ Security, Rate Limiting & Validation

1. **Helmet & CORS**:
   - HTTP response headers secured with Helmet.
   - CORS strictly configured to allow incoming traffic from `CLIENT_URL`.
2. **Input Validation (Zod)**:
   - Every incoming HTTP request and WebSocket event payload is validated through strict Zod schemas (`roomSchemas.js` and `socketSchemas.js`).
   - Rejections return standardized `{ code: 'INVALID_PAYLOAD', message }`.
3. **Multi-tier Rate Limiting**:
   - **REST API**: 10 room creations per 15 minutes per IP (`express-rate-limit`).
   - **Participant Change Requests**: Capped at 5 pending requests per participant (`RATE_LIMITED`).
   - **Live Chat**: Sliding-window rate limit capped at 5 messages per 10 seconds per user (`RATE_LIMITED`).
4. **Token Security**:
   - Session tokens are generated with `crypto.randomBytes(32)` (256-bit entropy).
   - Only `SHA-256` token hashes are stored in memory and MongoDB Atlas, preventing token leakage.

# Trap Card Game - Developer Guide

A comprehensive guide for maintaining and updating the Trap Card Game codebase.

## Table of Contents

- [Trap Card Game - Developer Guide](#trap-card-game---developer-guide)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
    - [Prerequisites](#prerequisites)
    - [Running Locally](#running-locally)
    - [Hot Reload Development](#hot-reload-development)
  - [Project Structure](#project-structure)
  - [Architecture Overview](#architecture-overview)
    - [System Diagram](#system-diagram)
    - [Authentication Flow](#authentication-flow)
    - [Game Flow](#game-flow)
  - [Component Interactions](#component-interactions)
    - [1. Authentication System](#1-authentication-system)
    - [2. Lobby Management](#2-lobby-management)
    - [3. Game State \& WebSocket](#3-game-state--websocket)
    - [4. Router \& Authentication Guards](#4-router--authentication-guards)
  - [Authentication System Details](#authentication-system-details)
    - [Backend Auth Service](#backend-auth-service)
    - [Frontend Auth Store](#frontend-auth-store)
  - [Adding New Features](#adding-new-features)
    - [Example 1: Add Password Reset](#example-1-add-password-reset)
    - [Example 2: Add User Profiles](#example-2-add-user-profiles)
    - [Example 3: Add Game Chat](#example-3-add-game-chat)
  - [Testing](#testing)
    - [Running Tests](#running-tests)
    - [Test Structure](#test-structure)
    - [Test-Driven Development](#test-driven-development)
  - [Deployment](#deployment)
    - [Production Checklist](#production-checklist)
    - [Docker Build](#docker-build)
    - [Environment Variables](#environment-variables)
  - [Common Tasks](#common-tasks)
    - [Task: Add a new API endpoint](#task-add-a-new-api-endpoint)
    - [Task: Add a new database field](#task-add-a-new-database-field)
    - [Task: Add a new Vue component](#task-add-a-new-vue-component)
    - [Task: Fix a bug](#task-fix-a-bug)
    - [Task: Handle offline/reconnection](#task-handle-offlinereconnection)
  - [Key Development Principles](#key-development-principles)
  - [Getting Help](#getting-help)
  - [Update History](#update-history)

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 22+ (for local development)
- Python 3.13 (with `uv` package manager)

### Running Locally

```bash
# Start all services (Postgres, Redis, Backend, Frontend)
docker-compose up

# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# Database: postgresql://localhost:5432/trapcard_game
```

### Hot Reload Development

Both frontend and backend support hot reload:

- **Frontend**: Vite dev server automatically reloads on file changes
- **Backend**: Uvicorn with `--reload` flag automatically restarts on file changes
- **No rebuilding needed** - just save and refresh your browser

---

## Project Structure

```txt
trap-card-game/
├── backend/                    # Python FastAPI backend
│   ├── app/
│   │   ├── api/               # REST API endpoints
│   │   │   ├── auth.py        # Authentication endpoints (register, login, me)
│   │   │   ├── lobby.py       # Lobby management endpoints
│   │   │   └── websocket.py   # WebSocket game events
│   │   ├── services/          # Business logic layer
│   │   │   ├── auth.py        # Auth service & token management
│   │   │   ├── password.py    # Password hashing utilities
│   │   │   ├── lobby.py       # Lobby service
│   │   │   ├── game.py        # Game logic
│   │   │   ├── pubsub.py      # Pub/Sub messaging
│   │   │   └── notification.py # Push notifications
│   │   ├── models/            # Data models
│   │   │   ├── database.py    # SQLAlchemy ORM models (Player, Lobby, GameAction)
│   │   │   └── schemas.py     # Pydantic request/response schemas
│   │   ├── database/          # Database configuration
│   │   │   └── session.py     # SQLAlchemy session management
│   │   ├── redis/             # Redis client
│   │   │   └── client.py      # Redis connection utilities
│   │   ├── config.py          # Environment configuration
│   │   └── main.py            # FastAPI app setup
│   ├── tests/                 # Unit & integration tests
│   │   ├── test_password_service.py    # Password hashing tests (8 tests)
│   │   ├── test_auth_service.py        # Auth service tests (17 tests)
│   │   ├── test_auth_api.py            # Auth endpoint tests (18 tests)
│   │   ├── test_models.py              # Database model tests
│   │   ├── test_lobby_service.py       # Lobby service tests
│   │   ├── test_game_service.py        # Game logic tests
│   │   ├── test_websocket.py           # WebSocket tests
│   │   ├── test_main.py                # API health check tests
│   │   ├── test_pubsub_service.py      # Pub/Sub tests
│   │   └── conftest.py                 # Pytest configuration
│   ├── pyproject.toml         # Project dependencies & pytest config
│   ├── Dockerfile             # Backend container image
│   └── .env                   # Environment variables
│
├── frontend/                  # Vue 3 + TypeScript frontend
│   ├── src/
│   │   ├── views/            # Page components
│   │   │   ├── HomeView.vue         # Lobby creation/joining page
│   │   │   ├── LoginView.vue        # Auth page (renders UserLogin component)
│   │   │   ├── LobbyView.vue        # Lobby waiting room
│   │   │   └── GameView.vue         # Game board
│   │   ├── components/       # Reusable components
│   │   │   ├── UserLogin.vue        # Login/Register form
│   │   │   ├── LobbyCreate.vue      # Create/Join lobby form
│   │   │   ├── LobbyWaiting.vue     # Player list while waiting
│   │   │   ├── GameBoard.vue        # Game UI
│   │   │   └── HelloWorld.vue       # Example component
│   │   ├── services/         # API clients & utilities
│   │   │   ├── auth.ts              # Auth API client
│   │   │   ├── api.ts              # Lobby & game API client
│   │   │   └── websocket.ts        # WebSocket client
│   │   ├── stores/           # Pinia state management
│   │   │   ├── auth.ts              # User authentication state
│   │   │   ├── lobby.ts             # Lobby state
│   │   │   └── game.ts              # Game state
│   │   ├── types/            # TypeScript type definitions
│   │   │   └── index.ts      # Game, Lobby, and Auth types
│   │   ├── router/           # Vue Router configuration
│   │   │   └── index.ts      # Route definitions & auth guards
│   │   ├── App.vue           # Root component
│   │   ├── main.ts           # App initialization & session restore
│   │   ├── style.css         # Global styles
│   │   └── config.ts         # Frontend configuration
│   ├── package.json          # Node dependencies
│   ├── vite.config.ts        # Vite bundler config
│   ├── tsconfig.json         # TypeScript config
│   ├── Dockerfile            # Frontend container image
│   └── nginx.conf            # Nginx production config
│
├── docker-compose.yml        # Compose config (Postgres, Redis, Backend, Frontend)
├── AGENTS.md                 # Guidelines for AI agents
└── HUMANS.md                 # This file - Developer guide
```

---

## Architecture Overview

### System Diagram

```shell
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vue 3)                        │
│                      http://localhost:5173                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ LoginView    │  │ HomeView     │  │ GameView     │          │
│  │ (UserLogin)  │  │ (LobbyCreate)│  │ (GameBoard)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │ auth store      │ lobby store      │ game store        │
│         └────────────┬────┴────────────┬─────┘                  │
│                      │                 │                        │
│         ┌────────────┴──────────┬──────┴────────────┐           │
│         │  Services (HTTP/WS)   │                  │            │
│         ├─────────────────────┬─┴────────────────┬─┤            │
│         │  auth.ts (REST)     │  websocket.ts    │ api.ts       │
│         │  - register         │  - game events   │ - lobbies   │
│         │  - login            │  - state updates │ - players   │
│         │  - validate token   │                  │             │
│         └─────────────────────┴──────────────────┴─┘            │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTP (REST/WebSocket)
           ┌───────────────┴───────────────┐
           │ Port 8000                     │
┌──────────▼────────────────────────────────────┐
│           BACKEND (FastAPI)                   │
│         http://localhost:8000                 │
├────────────────────────────────────────────────┤
│  API Layer (api/)                             │
│  ├─ POST   /api/auth/register                │
│  ├─ POST   /api/auth/login                   │
│  ├─ GET    /api/auth/me                      │
│  ├─ POST   /api/lobbies                      │
│  ├─ POST   /api/lobbies/{code}/join          │
│  ├─ POST   /api/lobbies/{code}/leave         │
│  ├─ GET    /api/lobbies/{code}/players       │
│  └─ WebSocket /ws                            │
├────────────────────────────────────────────────┤
│  Service Layer (services/)                    │
│  ├─ AuthService    (register, login, tokens)│
│  ├─ PasswordService (hash, verify)          │
│  ├─ LobbyService   (create, join, players)  │
│  ├─ GameService    (card logic)             │
│  └─ PubSubService  (message routing)        │
├────────────────────────────────────────────────┤
│  Data Layer                                   │
│  ├─ SQLAlchemy ORM (models/database.py)     │
│  ├─ Pydantic Schemas (models/schemas.py)    │
│  └─ Database Session (database/session.py)  │
└──────────┬──────────────────────┬─────────────┘
           │                      │
     ┌─────▼──────┐        ┌──────▼────────┐
     │ PostgreSQL │        │    Redis      │
     │  Port 5432 │        │   Port 6379   │
     │  (Persistence) │        │ (Caching/PubSub)
     └────────────┘        └───────────────┘
```

### Authentication Flow

```shell
User → Login/Register Form
       ↓
   POST /api/auth/register or /api/auth/login
       ↓
   Backend validates credentials
       ↓
   Create auth token (in-memory storage)
       ↓
   Return { user_id, username, token }
       ↓
   Frontend stores token in localStorage
       ↓
   Include token in Authorization header for all requests
       ↓
   Token persists across browser refreshes
```

### Game Flow

```shell
User (authenticated) → Create/Join Lobby
       ↓
   POST /api/lobbies (create) or /api/lobbies/{code}/join
       ↓
   Backend creates lobby or adds player to existing lobby
       ↓
   Frontend redirects to /lobby/{code}
       ↓
   WebSocket connection: /ws
       ↓
   Play cards, see game state updates in real-time
```

---

## Component Interactions

### 1. Authentication System

**Files Involved:**

- **Backend**: `app/services/auth.py`, `app/services/password.py`, `app/api/auth.py`
- **Frontend**: `src/services/auth.ts`, `src/stores/auth.ts`, `src/components/UserLogin.vue`

**How It Works:**

1. User fills login/register form in `UserLogin.vue`
2. Form calls `authStore.login()` or `authStore.register()`
3. Store calls `authService.login()` / `authService.register()`
4. Service makes HTTP request to backend
5. Backend `AuthService` handles credentials:
   - **Register**: Hash password with bcrypt, create new Player
   - **Login**: Find player by username, verify password hash
   - **Both**: Create token, return { user_id, username, token }
6. Frontend stores token in localStorage
7. Token auto-included in all API requests via `authService.getAuthHeader()`

**Key Files to Modify:**

- Change password requirements → `backend/app/models/schemas.py`
- Add OAuth/external auth → `backend/app/api/auth.py` (new endpoint)
- Change token expiry → `backend/app/services/auth.py` (TOKEN_EXPIRY_DAYS)
- Add password reset → `backend/app/api/auth.py` (new endpoint + email service)

---

### 2. Lobby Management

**Files Involved:**

- **Backend**: `app/services/lobby.py`, `app/api/lobby.py`, `app/services/auth.py`
- **Frontend**: `src/stores/lobby.ts`, `src/components/LobbyCreate.vue`, `src/views/LobbyView.vue`, `src/services/api.ts`

**How It Works:**

1. User must be authenticated (logged in with valid token)
2. User clicks "Create Lobby" → `LobbyCreate.vue` calls `lobbyStore.createLobby()`
   - Sends `POST /api/lobbies` with `Authorization: Bearer {token}` header
   - Backend validates token, creates lobby
3. Backend `LobbyService` generates unique 6-char code
4. User shown lobby code to share
5. Other users must log in, then enter code and click "Join" → `lobbyStore.joinLobby(code)`
   - Sends `POST /api/lobbies/{code}/join` with `Authorization: Bearer {token}` header
   - **No request body needed** (user info comes from token)
6. Backend validates:
   - Bearer token is valid and not expired
   - Authenticated user exists
   - Lobby exists and is active
   - Not full (max 10 players)
   - User not already in this lobby
7. Player (from authenticated user) added to lobby
8. WebSocket broadcasts player list updates to all connected clients

**Authentication Pattern:**

Both create and join endpoints require the `Authorization: Bearer {token}` header. The token is obtained after login and stored in localStorage. The frontend automatically includes this header via the `authService.getToken()` call.

```typescript
// Frontend example - API service handles auth automatically
const createLobby = async () => {
  const token = authService.getToken() // From localStorage
  const response = await fetch('/api/lobbies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  })
}
```

**Key Files to Modify:**

- Change lobby code format → `backend/app/services/lobby.py` (LOBBY_CODE_LENGTH)
- Add private/password-protected lobbies → `backend/app/models/database.py` (add field to Lobby model)
- Add spectator mode → `backend/app/services/lobby.py` (modify join logic)
- Change max players → `backend/app/services/lobby.py` (MAX_PLAYERS)
- Modify auth requirement → Update `authorization: str | None = Header(None)` check in `backend/app/api/lobby.py`

---

### 3. Game State & WebSocket

**Files Involved:**

- **Backend**: `app/api/websocket.py`, `app/services/game.py`, `app/services/pubsub.py`
- **Frontend**: `src/services/websocket.ts`, `src/stores/game.ts`, `src/views/GameView.vue`

**How It Works:**

1. Player joins lobby → WebSocket connection to `/ws`
2. Frontend sends `WSJoinMessage` with lobby_code and player_id
3. Backend `PubSubService` routes messages to appropriate lobby channel
4. When a player plays a card:
   - Frontend sends `WSPlayCardMessage`
   - Backend `GameService` validates move
   - Backend broadcasts `WSStateUpdateMessage` to all players in lobby
5. Frontend receives state update, Vue reactivity updates UI

**Key Files to Modify:**

- Add new game actions → `backend/app/services/game.py`
- Change card count → `backend/app/models/schemas.py` (PlayerView: cards_remaining)
- Add game rules → `backend/app/services/game.py`
- Change WebSocket message format → `backend/app/models/schemas.py` (WS*Message classes)

---

### 4. Router & Authentication Guards

**Files Involved:**

- **Frontend**: `src/router/index.ts`, `src/stores/auth.ts`, `src/main.ts`

**How It Works:**

1. App starts → `main.ts` calls `authStore.restoreSession()`
2. Store tries to load token from localStorage and validate with backend
3. Router guard (`beforeEach`) checks:
   - Is user authenticated? (isAuthenticated computed property)
   - Does route require auth? (meta.requiresAuth)
   - Redirect unauthenticated users to `/login`
   - Redirect authenticated users away from `/login` to `/`
4. Only authenticated users can access `/`, `/lobby/:code`, `/game/:code`

**Route Metadata:**

```shell
/login → requiresAuth: false (public)
/      → requiresAuth: true (requires login)
/lobby/:code → requiresAuth: true
/game/:code  → requiresAuth: true
```

**Key Files to Modify:**

- Add new routes → `src/router/index.ts` (add to routes array)
- Change guard logic → `src/router/index.ts` (beforeEach function)
- Change session restoration → `src/stores/auth.ts` (restoreSession action)

---

## Authentication System Details

### Backend Auth Service

**Location**: `backend/app/services/auth.py`

**Classes:**

- `AuthToken`: In-memory token storage with expiry checking
- `AuthService`: User registration, login, session validation

**Key Methods:**

```python
# Create new user
player, token = await auth_service.register_user("username", "123456")

# Authenticate user
player, token = await auth_service.login_user("username", "123456")

# Validate token
user_id = auth_service.validate_session(token)

# Get user by ID
player = await auth_service.get_user_by_id(user_id)
```

**Token Storage** (Current):

- In-memory dict: `AuthToken._tokens`
- Expires after 7 days
- Lost on server restart (for production, use Redis)

**To Upgrade to Redis:**

1. Modify `AuthToken` class in `backend/app/services/auth.py`
2. Replace `_tokens` dict with Redis client
3. Use keys like `auth:token:{token_hash}` with TTL

### Frontend Auth Store

**Location**: `frontend/src/stores/auth.ts`

**State:**

```typescript
userId: null | string
username: null | string
token: null | string
loading: boolean
error: null | string
```

**Computed Properties:**

```typescript
isAuthenticated: boolean  // userId && token are not null
```

**Actions:**

```typescript
async register(credentials)        // POST /api/auth/register
async login(credentials)           // POST /api/auth/login
function logout()                  // Clear state & localStorage
async restoreSession()             // Load token from localStorage
async validateToken()              // GET /api/auth/me
```

**Persist Token:**

```typescript
// Saved to localStorage as 'trap_card_auth_token'
authService.saveToken(token)
authService.getToken()
authService.clearToken()
```

---

## Adding New Features

### Example 1: Add Password Reset

**Backend:**

1. Add endpoint `POST /api/auth/reset-password` in `app/api/auth.py`
2. Add schema `PasswordResetRequest` in `app/models/schemas.py`
3. Add method `reset_password()` in `app/services/auth.py`
4. Send reset email via notification service
5. Add test in `tests/test_auth_api.py`

**Frontend:**

1. Add form component `PasswordReset.vue`
2. Add route `/reset-password` to router
3. Add method in `auth.ts` service to call endpoint
4. Add action in `auth.ts` store

---

### Example 2: Add User Profiles

**Backend:**

1. Extend Player model with `bio`, `avatar_url`, `created_at` in `app/models/database.py`
2. Add schema `UserProfile` in `app/models/schemas.py`
3. Add endpoint `GET /api/users/{user_id}` in new `app/api/users.py`
4. Add service methods in `app/services/auth.py`

**Frontend:**

1. Add service methods in `src/services/api.ts`
2. Add `UserProfile.vue` component
3. Add route `/profile/{user_id}` in router
4. Display profile in `LobbyWaiting.vue` for each player

---

### Example 3: Add Game Chat

**Backend:**

1. Add model `ChatMessage` in `app/models/database.py`
2. Add WebSocket handlers in `app/api/websocket.py` for chat messages
3. Add `WSChatMessage` schema in `app/models/schemas.py`
4. Broadcast to lobby channel via `PubSubService`

**Frontend:**

1. Add `ChatBox.vue` component
2. Add chat state to `game.ts` store
3. Send/receive messages in WebSocket handler
4. Display in `GameView.vue` or `LobbyView.vue`

---

## Testing

### Running Tests

```bash
# Backend - run all tests
docker-compose exec -T backend uv run pytest tests/ -v

# Backend - specific test file
docker-compose exec -T backend uv run pytest tests/test_auth_service.py -v

# Backend - specific test
docker-compose exec -T backend uv run pytest tests/test_password_service.py::TestPasswordService::test_hash_password_returns_string -v

# Backend - with coverage
docker-compose exec -T backend uv run pytest tests/ --cov=app --cov-report=html
```

### Test Structure

**Unit Tests** (test individual functions):

- `tests/test_password_service.py` - Password hashing
- `tests/test_models.py` - Database models
- `tests/test_auth_service.py` - Auth business logic

**Integration Tests** (test API endpoints):

- `tests/test_auth_api.py` - Auth endpoints
- `tests/test_lobby_service.py` - Lobby service
- `tests/test_game_service.py` - Game logic

**WebSocket Tests**:

- `tests/test_websocket.py` - Real-time game updates

### Test-Driven Development

For this project, tests should be written **before** implementation:

1. Write test(s) that fail
2. Implement code to make tests pass
3. Refactor if needed

Example:

```python
# tests/test_new_feature.py
async def test_my_new_feature(db_session):
    """Test description"""
    service = MyService(db_session)
    result = await service.my_method()
    assert result == expected_value

# Then implement: app/services/my_service.py
# Then run: pytest tests/test_new_feature.py -v
```

---

## Deployment

### Production Checklist

- [ ] Change `debug=False` in `backend/app/config.py`
- [ ] Set proper PostgreSQL password (not "trapcard")
- [ ] Move tokens to Redis (not in-memory)
- [ ] Configure CORS origins (not "*")
- [ ] Add HTTPS/SSL certificates
- [ ] Set up email service for notifications
- [ ] Configure Firebase admin SDK
- [ ] Add rate limiting to auth endpoints
- [ ] Set up database backups
- [ ] Configure monitoring/logging
- [ ] Add API authentication for sensitive endpoints

### Docker Build

```bash
# Build all images
docker-compose build

# Push to registry
docker tag trap-card-game-backend:latest myregistry/trap-card-game-backend:1.0
docker push myregistry/trap-card-game-backend:1.0
```

### Environment Variables

**Backend** (`.env`):

```shell
DATABASE_URL=postgresql://user:pass@postgres:5432/trapcard_game
REDIS_URL=redis://redis:6379
FIREBASE_CREDENTIALS=/path/to/firebase.json
ENVIRONMENT=production
DEBUG=false
```

**Frontend** (`.env`):

```shell
VITE_API_BASE_URL=https://api.example.com
VITE_WS_BASE_URL=wss://api.example.com
```

---

## Common Tasks

### Task: Add a new API endpoint

**Steps:**

1. Define schema in `backend/app/models/schemas.py`
2. Write test in `backend/tests/test_*.py`
3. Implement in `backend/app/api/*.py` or `backend/app/services/*.py`
4. Register route in `backend/app/main.py` (if new router)
5. Run tests: `pytest tests/test_*.py -v`
6. Test manually: `curl -X GET http://localhost:8000/api/...`

**For Protected Endpoints (require authentication):**

If the endpoint requires an authenticated user:

```python
from fastapi import Header, HTTPException, status

@router.post("/my-endpoint")
async def my_endpoint(
    data: MyRequestSchema,
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db)
):
    # Check authorization header
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required"
        )
    
    # Extract token
    try:
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise ValueError("Invalid authorization header")
        token = parts[1]
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header"
        )
    
    # Validate token and get user
    auth_service = AuthService(db)
    user_id = AuthService.validate_session(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    user = await auth_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    # Rest of endpoint logic...
```

From the frontend, include the token automatically:

```typescript
// The authService.getToken() retrieves it from localStorage
const response = await fetch('/api/my-endpoint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authService.getToken()}`,
  },
  body: JSON.stringify(data),
})
```

### Task: Add a new database field

**Steps:**

1. Update model in `backend/app/models/database.py`
2. Update schema in `backend/app/models/schemas.py`
3. Create database migration (or drop/recreate dev DB)
4. Update services to use new field
5. Update tests
6. Update frontend to display/use new field

### Task: Add a new Vue component

**Steps:**

1. Create `frontend/src/components/MyComponent.vue`
2. Add TypeScript types in `frontend/src/types/index.ts` (if needed)
3. Import and use in parent component
4. If needs data → add store in `frontend/src/stores/`
5. If needs API call → add service in `frontend/src/services/`

### Task: Fix a bug

**Steps:**

1. Identify which layer (frontend/backend)
2. Write test that reproduces bug
3. Run test to confirm it fails
4. Fix the bug
5. Run test to confirm it passes
6. Check related tests still pass
7. Commit with message "fix: description"

### Task: Handle offline/reconnection

**Backend already supports:**

- Persistent session storage (localStorage token)
- Token validation endpoint (`GET /api/auth/me`)

**To improve:**

1. Add exponential backoff for reconnection attempts
2. Queue messages while offline (use IndexedDB)
3. Sync queued messages when reconnected
4. Show "offline" indicator in UI

---

## Key Development Principles

1. **Test-Driven Development**: Write tests before code
2. **Separation of Concerns**: API → Service → Database layers
3. **Type Safety**: Use TypeScript types and Pydantic schemas
4. **Immutability**: Avoid mutations, use ref/computed in Vue
5. **DRY**: Don't repeat yourself - extract to services/utils
6. **Documentation**: Keep this file updated with major changes

---

## Getting Help

- **Backend errors** → Check logs: `docker-compose logs backend`
- **Database issues** → Check: `docker-compose logs postgres`
- **Frontend issues** → Check browser console
- **WebSocket issues** → Check: `docker-compose logs backend` for connection logs
- **Type errors** → Run: `npm run typecheck` (frontend) or `mypy app` (backend)

---

## Update History

- **Initial Release**: Authentication system, lobby creation/joining, basic game setup
- **Features**: Register/Login with 4-6 digit passwords, Token persistence, Session restore, Protected routes, User-aware lobbies
- **2026-06-07**: 
  - Made lobby endpoints (`POST /api/lobbies` and `POST /api/lobbies/{code}/join`) require Bearer token authentication
  - Fixed 422 validation error by correcting FastAPI Header parameter ordering (`authorization: str | None = Header(None)`)
  - Updated API service to send Authorization header in createLobby and joinLobby calls
  - Removed request body from joinLobby endpoint (user info comes from token)
  - Updated HUMANS.md with auth patterns and protected endpoint examples
- **2026-06-08**:
  - Fixed card targeting feature: Corrected `get_redis_client()` → `get_redis()` in PubSub service
  - Fixed game state broadcast: Convert datetime objects to ISO format strings for JSON serialization
  - Card plays now properly broadcast to all players with updated game state

---

**Last Updated**: 2026-06-08
**Maintained by**: Development Team

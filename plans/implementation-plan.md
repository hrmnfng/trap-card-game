# Trap Card Game - Detailed Implementation Plan

## Executive Summary

This document outlines the comprehensive implementation plan for the Trap Card Game, a real-time multiplayer PWA with hidden information mechanics and push notifications.

## Technology Stack

### Backend
- **Framework**: FastAPI (Python 3.13)
- **Package Manager**: uv
- **Database**: PostgreSQL 16 (SQLAlchemy async)
- **Cache/Pub-Sub**: Redis 7
- **WebSockets**: Native FastAPI WebSocket support
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Testing**: pytest, pytest-asyncio, pytest-cov

### Frontend
- **Framework**: Vue 3 with TypeScript
- **Build Tool**: Vite 8
- **State Management**: Pinia
- **Routing**: Vue Router 5
- **PWA**: vite-plugin-pwa with Workbox
- **Push Notifications**: Firebase SDK
- **Testing**: Vitest, @vue/test-utils

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Web Server**: Nginx (for production frontend)
- **Deployment**: Cloud-agnostic (AWS/GCP/VPS ready)

---

## Phase 1: Project Scaffolding ✅ COMPLETED

### 1.1 Backend Setup ✅
**Status**: Complete

**Completed Tasks**:
- ✅ Initialized Python project with uv
- ✅ Configured pyproject.toml with all dependencies
- ✅ Set up project structure (app/, tests/, models/, services/, etc.)
- ✅ Created configuration system (app/config.py) with Pydantic Settings
- ✅ Set up PostgreSQL connection with async SQLAlchemy
- ✅ Set up Redis client with connection pooling
- ✅ Implemented Firebase Admin SDK integration for FCM
- ✅ Created environment configuration (.env, .env.example)

**Key Files Created**:
- `backend/pyproject.toml` - Project dependencies and configuration
- `backend/app/config.py` - Environment-based configuration
- `backend/app/database/session.py` - Database session management
- `backend/app/redis/client.py` - Redis client with pub/sub support
- `backend/app/models/database.py` - SQLAlchemy models (Player, Lobby, GameAction)
- `backend/app/models/schemas.py` - Pydantic schemas for validation
- `backend/app/services/notification.py` - FCM notification service
- `backend/app/main.py` - FastAPI application entry point

### 1.2 Frontend Setup ✅
**Status**: Complete

**Completed Tasks**:
- ✅ Initialized Vue 3 + TypeScript project with Vite
- ✅ Installed dependencies (Pinia, Vue Router, Firebase, etc.)
- ✅ Configured Vite with PWA plugin
- ✅ Set up project structure (components/, views/, stores/, services/)
- ✅ Created TypeScript type definitions
- ✅ Configured PWA manifest with service worker
- ✅ Set up testing with Vitest
- ✅ Created environment configuration

**Key Files Created**:
- `frontend/vite.config.ts` - Vite configuration with PWA plugin
- `frontend/src/types/index.ts` - TypeScript type definitions
- `frontend/src/config.ts` - Environment configuration
- `frontend/.env` - Environment variables

### 1.3 Docker Configuration ✅
**Status**: Complete

**Completed Tasks**:
- ✅ Created docker-compose.yml with all services
- ✅ Created backend Dockerfile (Python 3.13 with uv)
- ✅ Created frontend Dockerfile (multi-stage: dev, build, production)
- ✅ Configured Nginx for production frontend
- ✅ Set up health checks for all services
- ✅ Configured volumes for data persistence

**Key Files Created**:
- `docker-compose.yml` - Complete service orchestration
- `backend/Dockerfile` - Backend container definition
- `frontend/Dockerfile` - Multi-stage frontend build
- `frontend/nginx.conf` - Nginx configuration for SPA

---

## Phase 2: Core Backend Implementation (TDD)

### 2.1 Database Models & Tests
**Status**: Pending (Models created, tests needed)
**Priority**: HIGH

**Next Steps**:
1. Write tests for database models:
   - Test Player model creation and relationships
   - Test Lobby model with unique code generation
   - Test GameAction model with foreign keys
   - Test model validation and constraints
2. Verify database migrations work correctly
3. Test async database operations

**Test Files to Create**:
- `backend/tests/test_models.py`
- `backend/tests/test_database.py`

**Acceptance Criteria**:
- All model tests pass
- Database tables created correctly
- Relationships work as expected
- Async operations function properly

### 2.2 Lobby Management Service
**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests First** (`backend/tests/test_lobby_service.py`):
   - Test lobby creation with unique 6-character codes
   - Test player joining with validation
   - Test max player limits (10 players)
   - Test lobby expiration (24 hours)
   - Test lobby not found scenarios
   - Test duplicate player joining prevention

2. **Implement Service** (`backend/app/services/lobby.py`):
   ```python
   class LobbyService:
       async def create_lobby(player_username: str) -> LobbyResponse
       async def join_lobby(code: str, player_username: str) -> LobbyResponse
       async def get_lobby_state(lobby_id: str, player_id: str) -> LobbyState
       async def remove_player(lobby_id: str, player_id: str) -> bool
       async def end_lobby(lobby_id: str) -> bool
   ```

3. **Create API Endpoints** (`backend/app/api/lobby.py`):
   - POST `/api/v1/lobby/create` - Create new lobby
   - POST `/api/v1/lobby/{code}/join` - Join existing lobby
   - GET `/api/v1/lobby/{lobby_id}/state` - Get current state
   - DELETE `/api/v1/lobby/{lobby_id}/leave` - Leave lobby

**Technical Requirements**:
- Store lobby state in Redis for fast access
- Persist lobby metadata in PostgreSQL
- Generate cryptographically secure random codes
- Implement TTL for lobby expiration
- Handle concurrent joins gracefully

### 2.3 Game State Management
**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests First** (`backend/tests/test_game_service.py`):
   - Test card deck initialization (3 cards per player, values 1-9)
   - Test card ownership validation
   - Test card play validation (player owns card, card is hidden)
   - Test card reveal mechanics
   - Test state filtering (hide opponent card values)
   - Test state serialization to/from Redis

2. **Implement Service** (`backend/app/services/game.py`):
   ```python
   class GameService:
       async def initialize_deck(lobby_id: str, player_ids: list[str]) -> bool
       async def play_card(lobby_id: str, player_id: str, 
                          card_id: str, target_id: str) -> bool
       async def get_state(lobby_id: str) -> dict
       async def filter_state(state: dict, player_id: str) -> LobbyState
       async def save_state(lobby_id: str, state: dict) -> bool
   ```

3. **Redis State Structure**:
   ```json
   {
     "lobby_id": "uuid",
     "status": "active",
     "players": {
       "player_id": {
         "username": "Player1",
         "cards": [
           {"id": "card1", "value": 5, "status": "hidden"},
           {"id": "card2", "value": 3, "status": "revealed"}
         ]
       }
     },
     "history": []
   }
   ```

**Technical Requirements**:
- Store complete game state in Redis
- Filter card values based on requesting player
- Update PostgreSQL with all game actions
- Validate all state transitions
- Handle edge cases (all cards played, lobby ended, etc.)

### 2.4 Redis Pub/Sub Service
**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests First** (`backend/tests/test_pubsub_service.py`):
   - Test publishing state updates to lobby channel
   - Test subscribing to lobby updates
   - Test channel isolation between lobbies
   - Test message serialization/deserialization
   - Test connection handling and recovery

2. **Implement Service** (`backend/app/services/pubsub.py`):
   ```python
   class PubSubService:
       async def publish_state_update(lobby_id: str, state: dict) -> bool
       async def subscribe_to_lobby(lobby_id: str) -> AsyncIterator[dict]
       async def unsubscribe_from_lobby(lobby_id: str) -> bool
   ```

**Technical Requirements**:
- Use Redis Pub/Sub for real-time broadcasts
- Channel naming: `lobby:{lobby_id}:updates`
- Handle subscriber disconnections
- Efficient message serialization (JSON)
- Connection pooling for performance

### 2.5 WebSocket Handler
**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests First** (`backend/tests/test_websocket.py`):
   - Test WebSocket connection with JWT auth
   - Test join message handling
   - Test play_card message handling
   - Test state update broadcasting
   - Test error handling
   - Test disconnection cleanup
   - Test concurrent connections in same lobby

2. **Implement WebSocket Handler** (`backend/app/websocket/handler.py`):
   ```python
   class WebSocketManager:
       async def connect(websocket: WebSocket, lobby_id: str, player_id: str)
       async def disconnect(websocket: WebSocket, lobby_id: str, player_id: str)
       async def handle_message(websocket: WebSocket, message: dict)
       async def broadcast_to_lobby(lobby_id: str, message: dict)
   ```

3. **Create WebSocket Endpoint** (`backend/app/api/websocket.py`):
   - WS `/ws/{lobby_id}` - WebSocket connection with JWT auth

**Message Types**:
- Client → Server:
  - `join` - Join lobby
  - `play_card` - Play a card on target
  - `get_state` - Request current state
  - `leave` - Leave lobby
  
- Server → Client:
  - `state_update` - Broadcast state changes
  - `error` - Error messages
  - `player_joined` - New player notification
  - `player_left` - Player departure notification

**Technical Requirements**:
- JWT validation in WebSocket handshake
- Maintain active connection registry
- Automatic reconnection handling
- Rate limiting on actions
- Graceful disconnection cleanup

### 2.6 FCM Push Notifications
**Status**: Service created, tests pending
**Priority**: MEDIUM

**Implementation Tasks**:
1. **Write Tests First** (`backend/tests/test_notification_service.py`):
   - Test FCM token registration
   - Test token retrieval
   - Test notification sending (mocked Firebase)
   - Test card played notification
   - Test notification failure handling

2. **Integration**:
   - Trigger notification on card play
   - Include game context in notification data
   - Handle missing tokens gracefully
   - Log notification delivery status

**Service Already Created**: `backend/app/services/notification.py`

---

## Phase 3: Frontend Implementation (TDD)

### 3.1 Core Services

#### WebSocket Service
**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests** (`frontend/src/services/__tests__/websocket.test.ts`)
2. **Implement** (`frontend/src/services/websocket.ts`):
   ```typescript
   class WebSocketService {
     connect(lobbyId: string, token: string): Promise<void>
     disconnect(): void
     send(message: WSMessage): void
     onMessage(callback: (message: WSMessage) => void): void
     reconnect(): void
   }
   ```

**Features**:
- Automatic reconnection with exponential backoff
- Message queuing during disconnection
- Heartbeat/ping mechanism
- TypeScript type safety

#### API Service
**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests** (`frontend/src/services/__tests__/api.test.ts`)
2. **Implement** (`frontend/src/services/api.ts`):
   ```typescript
   class ApiService {
     createLobby(username: string): Promise<LobbyResponse>
     joinLobby(code: string, username: string): Promise<LobbyResponse>
     getLobbyState(lobbyId: string): Promise<LobbyState>
     playCard(cardId: string, targetId: string): Promise<void>
   }
   ```

**Features**:
- Axios/Fetch wrapper with error handling
- JWT token management
- Request/response interceptors
- Type-safe API calls

#### Notification Service
**Status**: Pending
**Priority**: MEDIUM

**Implementation Tasks**:
1. **Write Tests** (`frontend/src/services/__tests__/notification.test.ts`)
2. **Implement** (`frontend/src/services/notification.ts`):
   ```typescript
   class NotificationService {
     requestPermission(): Promise<boolean>
     getToken(): Promise<string | null>
     onMessage(callback: (message: any) => void): void
     sendTokenToBackend(playerId: string, token: string): Promise<void>
   }
   ```

3. **Create Service Worker** (`frontend/public/firebase-messaging-sw.js`):
   - Handle background notifications
   - Display native notification UI
   - Handle notification clicks

### 3.2 State Management (Pinia)

**Status**: Pending
**Priority**: HIGH

**Implementation Tasks**:
1. **Write Tests** (`frontend/src/stores/__tests__/lobby.test.ts`)
2. **Implement Lobby Store** (`frontend/src/stores/lobby.ts`):
   ```typescript
   export const useLobbyStore = defineStore('lobby', {
     state: () => ({
       lobbyId: null,
       lobbyCode: null,
       status: 'waiting',
       players: [],
       myCards: [],
       gameHistory: [],
       connected: false,
     }),
     actions: {
       async createLobby(username: string),
       async joinLobby(code: string, username: string),
       playCard(cardId: string, targetId: string),
       updateState(state: LobbyState),
       disconnect(),
     },
     getters: {
       myHiddenCards: (state) => state.myCards.filter(c => c.status === 'hidden'),
       sortedPlayers: (state) => [...state.players].sort(...),
       canPlayCard: (state) => state.connected && state.myHiddenCards.length > 0,
     }
   })
   ```

### 3.3 UI Components

All components should follow TDD with component tests.

#### LobbyJoin.vue
**Priority**: HIGH
**Features**:
- Input for lobby code or username
- "Create Lobby" button
- "Join Lobby" button
- Loading states
- Error display

#### CardHand.vue
**Priority**: HIGH
**Features**:
- Display player's 3 cards
- Show card values for revealed cards
- Hide values for hidden cards
- Click to select card
- Disabled state when not player's turn

#### PlayerList.vue
**Priority**: HIGH
**Features**:
- List all players in lobby
- Show cards remaining per player
- Show cards revealed count
- Highlight current player
- Click to target player

#### GameBoard.vue
**Priority**: MEDIUM
**Features**:
- Leaderboard view
- Game history/timeline
- Visual representation of tags
- Animated state transitions

#### CardPlay.vue
**Priority**: HIGH
**Features**:
- Card selection interface
- Player targeting interface
- Confirm action button
- Cancel button

#### NotificationPrompt.vue
**Priority**: LOW
**Features**:
- Request notification permission
- Show permission status
- Explain notification benefits
- Dismissible

### 3.4 Views (Pages)

#### HomeView.vue (`/`)
- Welcome message
- Create/Join lobby interface
- Recent lobbies (optional)

#### LobbyView.vue (`/lobby/:code`)
- Main game interface
- Integrates all game components
- WebSocket connection management
- State synchronization

### 3.5 Routing

**File**: `frontend/src/router/index.ts`

```typescript
const routes = [
  { path: '/', component: HomeView },
  { path: '/lobby/:code', component: LobbyView },
  { path: '/:pathMatch(.*)*', component: NotFoundView },
]
```

---

## Phase 4: Integration & Testing

### 4.1 Backend Integration Tests
**Priority**: HIGH

**Test Scenarios**:
1. Complete lobby lifecycle (create → join → play → end)
2. Multiple players in single lobby
3. Concurrent card plays
4. WebSocket message flow end-to-end
5. State synchronization across clients
6. Notification delivery (mocked)
7. Player disconnection/reconnection
8. Error handling and recovery

**Test Files**:
- `backend/tests/integration/test_lobby_flow.py`
- `backend/tests/integration/test_multiplayer.py`
- `backend/tests/integration/test_websocket_flow.py`

### 4.2 Frontend E2E Tests
**Priority**: MEDIUM

**Test Scenarios**:
1. User creates lobby and receives code
2. Second user joins via code
3. Players see each other in lobby
4. Player plays card and target receives notification
5. Real-time state updates work
6. PWA installation flow
7. Offline behavior

**Tools**: Playwright or Cypress

**Test Files**:
- `frontend/e2e/lobby-creation.spec.ts`
- `frontend/e2e/multiplayer-game.spec.ts`
- `frontend/e2e/notifications.spec.ts`

### 4.3 Load Testing
**Priority**: LOW

**Test Scenarios**:
1. 10+ concurrent lobbies
2. 10 players per lobby
3. Rapid card plays
4. Redis Pub/Sub performance
5. WebSocket connection limits

**Tools**: Locust or k6

---

## Phase 5: Security & Production Readiness

### 5.1 Authentication & Authorization
**Priority**: HIGH

**Tasks**:
1. Implement JWT generation on lobby join
2. Add JWT validation middleware
3. Secure WebSocket connections with JWT
4. Add rate limiting:
   - Lobby creation: 5 per hour per IP
   - Card plays: 1 per second per player
5. Input sanitization for usernames and lobby codes
6. CSRF protection
7. XSS prevention

### 5.2 HTTPS/WSS Configuration
**Priority**: HIGH

**Tasks**:
1. Configure Nginx as reverse proxy
2. Set up SSL/TLS certificates:
   - Let's Encrypt for production
   - Self-signed for development
3. Enforce HTTPS redirects
4. Upgrade WebSocket to WSS
5. Configure security headers

**Nginx Config**:
- Add to `docker-compose.yml`
- Create `nginx/nginx.conf`
- Set up SSL certificate mounting

### 5.3 Monitoring & Logging
**Priority**: MEDIUM

**Tasks**:
1. Structured JSON logging (backend)
2. Log all game actions to PostgreSQL
3. Health check endpoints:
   - `/health` - Basic health
   - `/health/db` - Database connectivity
   - `/health/redis` - Redis connectivity
4. Metrics collection (optional):
   - Active lobbies
   - Active players
   - Messages per second
   - Response times

**Optional**: Prometheus + Grafana integration

### 5.4 Error Handling
**Priority**: HIGH

**Tasks**:
1. Global error handlers (backend + frontend)
2. User-friendly error messages
3. Automatic retry logic for transient failures
4. Circuit breaker for external services
5. Fallback behavior when Redis/DB unavailable

---

## Phase 6: Documentation & Deployment

### 6.1 Documentation
**Priority**: MEDIUM

**Tasks**:
1. API documentation (auto-generated from FastAPI)
2. WebSocket message protocol specification
3. Deployment guide for AWS/GCP/VPS
4. Environment variable reference
5. Troubleshooting guide
6. Architecture diagrams

### 6.2 Deployment Preparation
**Priority**: HIGH

**Tasks**:
1. Production Docker Compose configuration
2. Environment-specific configs (dev, staging, prod)
3. CI/CD pipeline (GitHub Actions):
   - Run tests on PR
   - Build Docker images
   - Security scans
   - Deploy to staging
4. Security audit:
   - `npm audit` (frontend)
   - `pip-audit` (backend)
5. Performance optimization:
   - Bundle size analysis
   - Lazy loading
   - Image optimization
   - Database indexing

### 6.3 Deployment
**Priority**: HIGH

**Tasks**:
1. Set up staging environment
2. Deploy to staging
3. User acceptance testing
4. Performance testing under load
5. Security penetration testing
6. Deploy to production
7. Monitor and iterate

---

## Key Design Decisions Needed

Before proceeding with Phase 2, please confirm:

### Game Mechanics
1. **Card Values**: 
   - Range: 1-9 (confirmed in config)
   - Can multiple players have the same card value? (Yes/No)
   
2. **Lobby Capacity**:
   - Max players: 10 (confirmed in config)
   - Min players to start: 2? (needs confirmation)

3. **Lobby Lifecycle**:
   - Auto-start when min players reached? (Yes/No)
   - Expiration: 24 hours (confirmed in config)
   - Allow joining after game started? (Yes/No)

4. **Game End Condition**:
   - All cards played? (recommended)
   - Time limit? (optional)
   - Manual end by lobby creator? (optional)
   - First to reveal all cards wins? (Yes/No)

5. **Notification Content**:
   - Show card value in notification? (recommended: Yes)
   - Show sender username? (recommended: Yes)
   - Deep link to lobby? (recommended: Yes)

### Technical Details
6. **Username Requirements**:
   - Unique per lobby only? (recommended)
   - Anonymous users allowed? (recommended: No)
   - Max length: 50 chars (confirmed)

7. **Card Assignment**:
   - Random assignment? (recommended: Yes)
   - Allow duplicates across players? (recommended: Yes)
   - Reassign if player leaves? (needs decision)

8. **Reconnection Behavior**:
   - Preserve player state on disconnect? (recommended: Yes for 5 mins)
   - Allow rejoining same lobby? (recommended: Yes)
   - What if lobby filled while disconnected? (needs decision)

---

## Estimated Timeline

### Current Status: Phase 1 Complete (Week 1 equivalent)

### Remaining Phases:
- **Phase 2 (Core Backend)**: 1-2 weeks
  - 2.1-2.2: 2-3 days
  - 2.3-2.4: 3-4 days
  - 2.5-2.6: 2-3 days

- **Phase 3 (Frontend)**: 1-2 weeks
  - 3.1-3.2: 3-4 days
  - 3.3-3.5: 4-5 days

- **Phase 4 (Integration & Testing)**: 3-5 days

- **Phase 5 (Security & Production)**: 3-5 days

- **Phase 6 (Deployment)**: 2-3 days

**Total Remaining**: 4-6 weeks

---

## Next Steps

1. **Immediate**: Review and confirm game mechanics decisions above
2. **Week 2**: Begin Phase 2.1 (Database model tests)
3. **Week 2-3**: Complete Phase 2 (Backend core)
4. **Week 3-4**: Complete Phase 3 (Frontend)
5. **Week 5**: Integration testing
6. **Week 6**: Production readiness and deployment

---

## Success Criteria

### MVP (Minimum Viable Product)
- [ ] Users can create and join lobbies
- [ ] Players receive 3 random cards
- [ ] Players can play cards on other players
- [ ] Real-time state updates via WebSocket
- [ ] Basic leaderboard/history view
- [ ] PWA installable on mobile
- [ ] Works in Docker Compose

### Full Launch
- [ ] Push notifications working
- [ ] Production-ready security
- [ ] Comprehensive test coverage (>80%)
- [ ] Performance tested under load
- [ ] Deployed to production
- [ ] Monitoring and logging in place
- [ ] Documentation complete

---

## Appendix: File Structure Reference

```
trap-card-game/
├── backend/
│   ├── app/
│   │   ├── __init__.py ✅
│   │   ├── main.py ✅
│   │   ├── config.py ✅
│   │   ├── database/
│   │   │   ├── __init__.py ✅
│   │   │   └── session.py ✅
│   │   ├── models/
│   │   │   ├── __init__.py ✅
│   │   │   ├── database.py ✅
│   │   │   └── schemas.py ✅
│   │   ├── redis/
│   │   │   ├── __init__.py ✅
│   │   │   └── client.py ✅
│   │   ├── services/
│   │   │   ├── __init__.py ✅
│   │   │   ├── notification.py ✅
│   │   │   ├── lobby.py ⏳ (next)
│   │   │   ├── game.py ⏳
│   │   │   └── pubsub.py ⏳
│   │   ├── websocket/
│   │   │   ├── __init__.py ⏳
│   │   │   └── handler.py ⏳
│   │   └── api/
│   │       ├── __init__.py ⏳
│   │       ├── lobby.py ⏳
│   │       └── websocket.py ⏳
│   ├── tests/
│   │   ├── __init__.py ✅
│   │   ├── conftest.py ✅
│   │   ├── test_main.py ✅
│   │   ├── test_models.py ⏳ (next)
│   │   ├── test_lobby_service.py ⏳
│   │   ├── test_game_service.py ⏳
│   │   └── integration/ ⏳
│   ├── .env ✅
│   ├── .env.example ✅
│   ├── .gitignore ✅
│   ├── Dockerfile ✅
│   └── pyproject.toml ✅
├── frontend/
│   ├── src/
│   │   ├── main.ts ✅
│   │   ├── App.vue ✅
│   │   ├── config.ts ✅
│   │   ├── types/
│   │   │   └── index.ts ✅
│   │   ├── services/
│   │   │   ├── api.ts ⏳
│   │   │   ├── websocket.ts ⏳
│   │   │   └── notification.ts ⏳
│   │   ├── stores/
│   │   │   └── lobby.ts ⏳
│   │   ├── components/
│   │   │   ├── LobbyJoin.vue ⏳
│   │   │   ├── CardHand.vue ⏳
│   │   │   ├── PlayerList.vue ⏳
│   │   │   ├── GameBoard.vue ⏳
│   │   │   └── CardPlay.vue ⏳
│   │   └── views/
│   │       ├── HomeView.vue ⏳
│   │       └── LobbyView.vue ⏳
│   ├── public/
│   │   └── firebase-messaging-sw.js ⏳
│   ├── .env ✅
│   ├── .env.example ✅
│   ├── .gitignore ✅
│   ├── Dockerfile ✅
│   ├── nginx.conf ✅
│   ├── package.json ✅
│   └── vite.config.ts ✅
├── plans/
│   ├── outline.md ✅
│   └── implementation-plan.md ✅ (this file)
├── .gitignore ✅
├── docker-compose.yml ✅
├── AGENTS.md ✅
└── README.md ✅

Legend:
✅ Completed
⏳ Pending
```

---

## Questions?

This plan is comprehensive but flexible. As we proceed, we'll refine and adjust based on:
- Technical discoveries
- User feedback (if applicable)
- Performance requirements
- Timeline constraints

Ready to proceed with Phase 2? Let's start with database model tests!

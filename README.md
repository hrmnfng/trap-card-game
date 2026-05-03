# Trap Card Game

A real-time multiplayer card game with hidden information mechanics, built as a Progressive Web App (PWA).

## Architecture

- **Backend**: FastAPI (Python 3.13) with WebSockets
- **Frontend**: Vue 3 + TypeScript + Vite
- **Database**: PostgreSQL
- **Cache/Pub-Sub**: Redis
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Deployment**: Docker Compose

## Features

- Real-time WebSocket communication
- Hidden card mechanics
- Push notifications when targeted
- PWA with offline support
- Mobile-first responsive design

## Prerequisites

- Docker & Docker Compose
- Node.js 22+ (for local development)
- Python 3.13+ (for local development)
- uv (Python package manager)

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Local Development

#### Backend

```bash
cd backend

# Install dependencies
uv sync --dev

# Run migrations (create tables)
uv run python -c "from app.database import init_db; import asyncio; asyncio.run(init_db())"

# Start development server
uv run uvicorn app.main:app --reload

# Run tests
uv run pytest
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install --legacy-peer-deps

# Start development server
npm run dev

# Run tests
npm run test

# Build for production
npm run build
```

## Environment Variables

### Backend (.env)

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=trapcard
POSTGRES_PASSWORD=trapcard
POSTGRES_DB=trapcard_game

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET_KEY=your-secret-key-change-in-production

# Firebase (optional)
FIREBASE_CREDENTIALS_PATH=/path/to/firebase-credentials.json
FCM_ENABLED=true
```

### Frontend (.env)

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000

# Firebase configuration
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_PROJECT_ID=your-project-id
# ... other Firebase config
```

## Game Mechanics

1. **Lobby Creation**: Create or join a lobby with a unique code
2. **Card Distribution**: Each player gets 3 hidden cards (values 1-9)
3. **Card Play**: Choose a hidden card and target another player
4. **Reveal**: The card value becomes public and the target is notified
5. **Leaderboard**: Track cards revealed and tagging history

## Testing

### Backend Tests

```bash
cd backend
uv run pytest --cov=app --cov-report=html
```

### Frontend Tests

```bash
cd frontend
npm run test:coverage
```

## Security Audit

```bash
# Frontend
cd frontend
npm audit

# Backend
cd backend
uv export --format requirements.txt > requirements.txt
pip-audit -r requirements.txt
```

## Project Structure

```
trap-card-game/
├── backend/
│   ├── app/
│   │   ├── database/      # Database models and session
│   │   ├── models/        # Pydantic schemas
│   │   ├── redis/         # Redis client
│   │   ├── services/      # Business logic
│   │   ├── websocket/     # WebSocket handlers
│   │   ├── config.py      # Configuration
│   │   └── main.py        # FastAPI app
│   ├── tests/
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/    # Vue components
│   │   ├── views/         # Page views
│   │   ├── stores/        # Pinia stores
│   │   ├── services/      # API clients
│   │   ├── types/         # TypeScript types
│   │   └── main.ts
│   ├── public/
│   └── package.json
├── plans/                 # Design documents
├── docker-compose.yml
└── README.md
```

## Contributing

This project follows Test-Driven Development (TDD):

1. Write tests first
2. Implement functionality
3. Run tests to verify
4. Refactor as needed

## License

MIT

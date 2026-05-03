# Quick Start Guide

## Phase 1 Complete - Infrastructure Ready

We've successfully completed Phase 1 of the Trap Card Game implementation. Here's what's ready and how to test it.

## What's Been Built

### Backend ✅

- FastAPI application structure
- PostgreSQL database models (Player, Lobby, GameAction)
- Redis client with pub/sub support
- Firebase Cloud Messaging integration
- Configuration system with environment variables
- Basic API endpoints (/health, /)

### Frontend ✅

- Vue 3 + TypeScript + Vite setup
- PWA configuration with manifest
- TypeScript type definitions
- Pinia state management structure
- Firebase client setup for notifications

### Infrastructure ✅

- Docker Compose with PostgreSQL, Redis, Backend, Frontend
- Multi-stage Dockerfiles for production builds
- Nginx configuration for frontend production
- Volume persistence for databases

## Quick Test

### Option 1: Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# Check services are running
docker-compose ps

# View logs
docker-compose logs -f backend

# The services will be available at:
# - Frontend: http://localhost:5173
# - Backend: http://localhost:8000
# - API Docs: http://localhost:8000/docs
# - PostgreSQL: http://localhost:5432
# - Redis: http://localhost:6379
```

### Option 2: Local Development

#### Terminal 1 - Start PostgreSQL and Redis

```bash
docker-compose up postgres redis
```

#### Terminal 2 - Start Backend

```bash
cd backend

# Activate virtual environment
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Run the application
uv run uvicorn app.main:app --reload

# Test the endpoints
# http://localhost:8000/health
# http://localhost:8000/docs
```

#### Terminal 3 - Start Frontend

```bash
cd frontend

# Start development server
npm run dev

# Access at http://localhost:5173
```

## Verify Installation

### Backend Health Check

```bash
curl http://localhost:8000/health
# Expected: {"status":"healthy"}
```

### Test Database Connection

```bash
# Connect to PostgreSQL
docker exec -it trapcard-postgres psql -U trapcard -d trapcard_game

# List tables (should be empty until migrations run)
\dt

# Exit
\q
```

### Test Redis Connection

```bash
# Connect to Redis
docker exec -it trapcard-redis redis-cli

# Test command
PING
# Expected: PONG

# Exit
exit
```

## Run Tests

### Backend Tests

```bash
cd backend
uv run pytest -v

# With coverage
uv run pytest --cov=app --cov-report=html
```

### Frontend Tests

```bash
cd frontend
npm run test
```

## Common Issues

### Issue: Port already in use

```bash
# Check what's using the port
# Windows
netstat -ano | findstr :8000

# Linux/Mac
lsof -i :8000

# Solution: Stop the process or change port in docker-compose.yml
```

### Issue: Docker containers won't start

```bash
# Remove all containers and volumes
docker-compose down -v

# Rebuild images
docker-compose build --no-cache

# Start again
docker-compose up -d
```

### Issue: Frontend dependency errors

```bash
cd frontend

# Clean install
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### Issue: Backend dependencies not installing

```bash
cd backend

# Remove virtual environment
rm -rf .venv

# Reinstall
uv sync --dev
```

## Security Audit

### Frontend

```bash
cd frontend
npm audit
```

### Backend

```bash
cd backend
uv export --format requirements.txt > requirements.txt
pip-audit -r requirements.txt
```

## Next Steps

Now that Phase 1 is complete, we're ready to proceed with Phase 2:

1. **Database Model Tests** - Write comprehensive tests for SQLAlchemy models
2. **Lobby Service** - Implement lobby creation and management with TDD
3. **Game Service** - Implement card game logic with TDD
4. **WebSocket Handler** - Real-time communication layer
5. **Frontend Components** - Build the UI

See `plans/implementation-plan.md` for detailed Phase 2 tasks.

## Project Structure

```text
trap-card-game/
├── backend/          # Python FastAPI backend
├── frontend/         # Vue 3 frontend
├── plans/            # Design and planning docs
├── docker-compose.yml
├── README.md         # Full documentation
├── QUICKSTART.md     # This file
└── AGENTS.md         # AI agent instructions
```

## Need Help?

- Check `README.md` for comprehensive documentation
- Check `plans/implementation-plan.md` for detailed technical plan
- Review `plans/outline.md` for original design
- Check backend API docs at `http://localhost:8000/docs`

## Development Tips

1. **Backend Development**:
   - FastAPI auto-reloads on code changes
   - Use `/docs` for interactive API testing
   - Check logs with `docker-compose logs -f backend`

2. **Frontend Development**:
   - Vite hot-reloads instantly
   - TypeScript catches errors at compile time
   - Use Vue DevTools browser extension

3. **Database Changes**:
   - Modify models in `backend/app/models/database.py`
   - Recreate tables: `docker-compose down -v && docker-compose up -d`
   - Consider adding Alembic for migrations later

4. **Testing Philosophy**:
   - Write tests first (TDD)
   - Test behavior, not implementation
   - Aim for >80% coverage

## Celebrate

Phase 1 is complete! The foundation is solid and ready for building the core game logic.

Ready to build something awesome? Let's go! 🚀

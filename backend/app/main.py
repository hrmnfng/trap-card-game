"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.lobby import router as lobby_router
from app.api.websocket import router as websocket_router
from app.config import get_settings
from app.database import init_db
from app.logger import logger
from app.redis import close_redis, init_redis

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    # Startup
    await init_redis()
    await init_db()
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request logging middleware (for debugging auth issues)
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests with headers for debugging."""
    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path
    method = request.method
    
    # Log request details
    auth_header = request.headers.get("authorization", "MISSING")
    logger.info(f"{method} {path} from {client_ip} - Auth header: {auth_header[:30] if auth_header != 'MISSING' else 'MISSING'}...")
    
    # Process request
    response = await call_next(request)
    
    # Log response status
    if response.status_code >= 400:
        logger.warning(f"{method} {path} - Response: {response.status_code}")
    
    return response


# Register API routers
app.include_router(auth_router, prefix="/api")
app.include_router(lobby_router, prefix="/api")
app.include_router(websocket_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": "Trap Card Game API", "version": "0.1.0"}

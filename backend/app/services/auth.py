"""Authentication service for user registration and login."""

import json
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.logger import logger
from app.models.database import Player
from app.services.password import PasswordService


class AuthToken:
    """Token storage and management using Redis (with in-memory fallback)."""

    TOKEN_EXPIRY_DAYS = 7
    _redis_client = None
    # Fallback in-memory store if Redis is unavailable
    _tokens: dict[str, dict] = {}

    @classmethod
    def _get_redis(cls):
        """Get Redis client (lazy initialization)."""
        if cls._redis_client is None:
            try:
                settings = get_settings()
                # Parse Redis URL to get host/port/db
                redis_url = str(settings.redis_url)
                # Extract components from redis://host:port/db
                cls._redis_client = redis.Redis(
                    host=settings.redis_host,
                    port=settings.redis_port,
                    db=settings.redis_db,
                    decode_responses=True,
                )
                # Test connection
                cls._redis_client.ping()
            except Exception as e:
                logger.error(f"Redis connection failed, using in-memory fallback: {e}")
                cls._redis_client = None
        return cls._redis_client

    @classmethod
    def create_token(cls, user_id: str) -> str:
        """Create a new auth token for a user.
        
        Args:
            user_id: Player UUID
            
        Returns:
            Auth token string
        """
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=cls.TOKEN_EXPIRY_DAYS)
        
        token_data = {
            'user_id': user_id,
            'expires_at': expires_at.isoformat()
        }
        
        # Try to store in Redis
        redis_client = cls._get_redis()
        if redis_client:
            try:
                # Store in Redis with TTL (7 days in seconds)
                ttl_seconds = cls.TOKEN_EXPIRY_DAYS * 24 * 60 * 60
                redis_client.setex(
                    f"auth_token:{token}",
                    ttl_seconds,
                    json.dumps(token_data)
                )
            except Exception as e:
                logger.error(f"Redis store failed, falling back to in-memory: {e}")
                cls._tokens[token] = token_data
        else:
            # Fallback to in-memory storage
            cls._tokens[token] = token_data
        
        return token

    @classmethod
    def validate_token(cls, token: str) -> str | None:
        """Validate a token and return user_id if valid.
        
        Args:
            token: Auth token to validate
            
        Returns:
            User ID if token is valid, None otherwise
        """
        # Try Redis first
        redis_client = cls._get_redis()
        if redis_client:
            try:
                token_data_str = redis_client.get(f"auth_token:{token}")
                if token_data_str:
                    token_data = json.loads(token_data_str)
                    return token_data['user_id']
            except Exception as e:
                logger.error(f"Redis lookup failed, checking in-memory: {e}")
        
        # Fallback to in-memory storage
        if token not in cls._tokens:
            return None
        
        token_data = cls._tokens[token]
        
        # Check if expired
        expires_at = datetime.fromisoformat(token_data['expires_at'])
        if datetime.now(timezone.utc) > expires_at:
            del cls._tokens[token]
            return None
        
        return token_data['user_id']

    @classmethod
    def revoke_token(cls, token: str) -> None:
        """Revoke a token.
        
        Args:
            token: Auth token to revoke
        """
        # Try to revoke in Redis
        redis_client = cls._get_redis()
        if redis_client:
            try:
                redis_client.delete(f"auth_token:{token}")
            except Exception as e:
                logger.error(f"Redis delete failed: {e}")
        
        # Also remove from in-memory storage
        cls._tokens.pop(token, None)


class AuthService:
    """Service for user authentication."""

    def __init__(self, db_session: AsyncSession):
        """Initialize auth service with database session.
        
        Args:
            db_session: SQLAlchemy async session
        """
        self.db = db_session

    async def register_user(self, username: str, password: str) -> tuple[Player, str]:
        """Register a new user.
        
        Args:
            username: Username (1-50 chars)
            password: Password (4-6 digits)
            
        Returns:
            Tuple of (Player, token)
            
        Raises:
            ValueError: If username already exists or invalid input
        """
        # Check if username already exists
        result = await self.db.execute(
            select(Player).where(Player.username == username)
        )
        if result.scalar_one_or_none():
            raise ValueError(f"Username '{username}' is already taken")
        
        # Hash password
        password_hash = PasswordService.hash_password(password)
        
        # Create player
        player = Player(
            username=username,
            password_hash=password_hash
        )
        
        self.db.add(player)
        await self.db.commit()
        await self.db.refresh(player)
        
        # Create token
        token = AuthToken.create_token(player.id)
        
        return player, token

    async def login_user(self, username: str, password: str) -> tuple[Player, str]:
        """Login a user.
        
        Args:
            username: Username
            password: Password
            
        Returns:
            Tuple of (Player, token)
            
        Raises:
            ValueError: If username doesn't exist or password is wrong
        """
        # Find player by username
        result = await self.db.execute(
            select(Player).where(Player.username == username)
        )
        player = result.scalar_one_or_none()
        
        if not player:
            raise ValueError(f"Username or password is incorrect")
        
        # Verify password
        if not PasswordService.verify_password(password, player.password_hash):
            raise ValueError(f"Username or password is incorrect")
        
        # Create token
        token = AuthToken.create_token(player.id)
        
        return player, token

    @staticmethod
    def validate_session(token: str) -> str | None:
        """Validate a session token.
        
        Args:
            token: Auth token to validate
            
        Returns:
            User ID if valid, None otherwise
        """
        return AuthToken.validate_token(token)

    async def get_user_by_id(self, user_id: str) -> Player | None:
        """Get user by ID.
        
        Args:
            user_id: Player UUID
            
        Returns:
            Player instance or None if not found
        """
        result = await self.db.execute(
            select(Player).where(Player.id == user_id)
        )
        return result.scalar_one_or_none()

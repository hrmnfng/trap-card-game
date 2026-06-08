"""Database session management with SQLAlchemy async support."""

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# Import logger first to configure logging before engine creation
import app.logger  # noqa: F401

from app.config import get_settings

settings = get_settings()

# Create async engine  
# Note: echo=True creates duplicate logs with different formats (SQLAlchemy's native + our custom)
# To maintain consistent log formatting, echo is disabled
# SQL queries are not logged to keep console output clean
engine = create_async_engine(
    str(settings.database_url),
    echo=False,  # Disabled to prevent duplicate/inconsistent log formats
    echo_pool=False,  # No pool connection logging
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database tables."""
    # Import models to ensure they're registered with Base.metadata
    import app.models.database  # noqa: F401
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_db() -> None:
    """Drop all database tables (for testing)."""
    # Import models to ensure they're registered with Base.metadata
    import app.models.database  # noqa: F401
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

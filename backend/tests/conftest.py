"""Pytest configuration and fixtures."""

import asyncio
import pytest
import pytest_asyncio
from collections.abc import AsyncGenerator
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.session import async_session_maker, init_db, drop_db, engine


@pytest.fixture(scope="session")
def event_loop_policy():
    """Set event loop policy for all tests."""
    return asyncio.WindowsProactorEventLoopPolicy()


@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_db():
    """Setup and teardown test database for each test."""
    # Clean up any existing tables first
    try:
        await drop_db()
    except Exception:
        pass
    
    # Create fresh tables
    await init_db()
    yield
    
    # Clean up after test
    try:
        await drop_db()
    except Exception:
        pass
    finally:
        # Dispose engine connections after each test to prevent connection leaks
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a database session for tests."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Create test client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

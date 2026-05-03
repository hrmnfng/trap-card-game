"""Pytest configuration and fixtures."""

import pytest
from collections.abc import AsyncGenerator
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture(scope="session")
def event_loop_policy():
    """Set event loop policy for all tests."""
    import asyncio
    return asyncio.DefaultEventLoopPolicy()


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Create test client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

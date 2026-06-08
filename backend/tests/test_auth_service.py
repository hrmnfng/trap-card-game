"""Tests for authentication service."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player
from app.services.auth import AuthService, AuthToken
from app.database.session import async_session_maker, init_db, drop_db


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    """Setup and teardown test database for each test."""
    await init_db()
    yield
    await drop_db()


@pytest.fixture
async def db_session() -> AsyncSession:
    """Provide a database session for tests."""
    async with async_session_maker() as session:
        yield session


class TestAuthToken:
    """Test authentication token management."""

    def test_create_token_returns_string(self):
        """Test that create_token returns a string."""
        token = AuthToken.create_token("test-user-id")
        assert isinstance(token, str)
        assert len(token) > 0

    def test_validate_token_success(self):
        """Test validating a valid token."""
        user_id = "test-user-id"
        token = AuthToken.create_token(user_id)
        
        validated_user_id = AuthToken.validate_token(token)
        assert validated_user_id == user_id

    def test_validate_token_invalid(self):
        """Test validating an invalid token."""
        validated_user_id = AuthToken.validate_token("invalid-token")
        assert validated_user_id is None

    def test_validate_token_after_revoke(self):
        """Test that revoked token is invalid."""
        user_id = "test-user-id"
        token = AuthToken.create_token(user_id)
        
        AuthToken.revoke_token(token)
        validated_user_id = AuthToken.validate_token(token)
        assert validated_user_id is None

    def test_different_tokens_for_same_user(self):
        """Test that different tokens are created each time."""
        user_id = "test-user-id"
        token1 = AuthToken.create_token(user_id)
        token2 = AuthToken.create_token(user_id)
        
        assert token1 != token2
        assert AuthToken.validate_token(token1) == user_id
        assert AuthToken.validate_token(token2) == user_id


class TestAuthService:
    """Test authentication service."""

    async def test_register_user_success(self, db_session: AsyncSession):
        """Test successful user registration."""
        service = AuthService(db_session)
        
        player, token = await service.register_user("testuser", "123456")
        
        assert player.id is not None
        assert player.username == "testuser"
        assert player.password_hash is not None
        assert token is not None
        assert AuthToken.validate_token(token) == player.id

    async def test_register_user_duplicate_username(self, db_session: AsyncSession):
        """Test registering with duplicate username."""
        service = AuthService(db_session)
        
        await service.register_user("testuser", "123456")
        
        with pytest.raises(ValueError, match="already taken"):
            await service.register_user("testuser", "654321")

    async def test_register_user_creates_different_password_hashes(
        self, db_session: AsyncSession
    ):
        """Test that same password creates different hashes for different users."""
        service = AuthService(db_session)
        
        player1, _ = await service.register_user("user1", "123456")
        player2, _ = await service.register_user("user2", "123456")
        
        assert player1.password_hash != player2.password_hash

    async def test_login_user_success(self, db_session: AsyncSession):
        """Test successful user login."""
        service = AuthService(db_session)
        
        # Register user first
        await service.register_user("testuser", "123456")
        
        # Login
        player, token = await service.login_user("testuser", "123456")
        
        assert player.username == "testuser"
        assert token is not None
        assert AuthToken.validate_token(token) == player.id

    async def test_login_user_wrong_password(self, db_session: AsyncSession):
        """Test login with wrong password."""
        service = AuthService(db_session)
        
        await service.register_user("testuser", "123456")
        
        with pytest.raises(ValueError, match="incorrect"):
            await service.login_user("testuser", "654321")

    async def test_login_user_nonexistent(self, db_session: AsyncSession):
        """Test login with non-existent user."""
        service = AuthService(db_session)
        
        with pytest.raises(ValueError, match="incorrect"):
            await service.login_user("nonexistent", "123456")

    async def test_login_user_empty_password(self, db_session: AsyncSession):
        """Test login with empty password."""
        service = AuthService(db_session)
        
        await service.register_user("testuser", "123456")
        
        with pytest.raises(ValueError, match="incorrect"):
            await service.login_user("testuser", "")

    async def test_validate_session_success(self, db_session: AsyncSession):
        """Test validating a session."""
        service = AuthService(db_session)
        
        player, token = await service.register_user("testuser", "123456")
        
        user_id = AuthService.validate_session(token)
        assert user_id == player.id

    async def test_validate_session_invalid(self, db_session: AsyncSession):
        """Test validating an invalid session."""
        user_id = AuthService.validate_session("invalid-token")
        assert user_id is None

    async def test_get_user_by_id_success(self, db_session: AsyncSession):
        """Test getting user by ID."""
        service = AuthService(db_session)
        
        player, _ = await service.register_user("testuser", "123456")
        
        retrieved = await service.get_user_by_id(player.id)
        assert retrieved is not None
        assert retrieved.id == player.id
        assert retrieved.username == "testuser"

    async def test_get_user_by_id_not_found(self, db_session: AsyncSession):
        """Test getting non-existent user."""
        service = AuthService(db_session)
        
        user = await service.get_user_by_id("nonexistent-id")
        assert user is None

    async def test_login_and_validate_session_flow(
        self, db_session: AsyncSession
    ):
        """Test complete login and session validation flow."""
        service = AuthService(db_session)
        
        # Register
        await service.register_user("alice", "111111")
        
        # Login
        player, token = await service.login_user("alice", "111111")
        
        # Validate session
        user_id = AuthService.validate_session(token)
        assert user_id == player.id
        
        # Get user from session
        user = await service.get_user_by_id(user_id)
        assert user is not None
        assert user.username == "alice"

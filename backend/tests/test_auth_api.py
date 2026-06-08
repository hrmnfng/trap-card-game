"""Tests for authentication API endpoints."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.session import async_session_maker, init_db, drop_db


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    """Setup and teardown test database for each test."""
    await init_db()
    yield
    await drop_db()


@pytest.fixture
async def client():
    """Provide an async HTTP client for testing."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client


class TestAuthRegisterEndpoint:
    """Test user registration endpoint."""

    async def test_register_success(self, client: AsyncClient):
        """Test successful user registration."""
        response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["username"] == "testuser"
        assert data["user_id"] is not None
        assert data["token"] is not None

    async def test_register_duplicate_username(self, client: AsyncClient):
        """Test registering with duplicate username."""
        # Register first user
        await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        
        # Try to register with same username
        response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "654321"}
        )
        
        assert response.status_code == 409
        data = response.json()
        assert "already taken" in data["detail"]

    async def test_register_invalid_password_non_digits(self, client: AsyncClient):
        """Test registering with non-digit password."""
        response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "abc123"}
        )
        
        assert response.status_code == 422  # Validation error

    async def test_register_password_too_short(self, client: AsyncClient):
        """Test registering with password too short."""
        response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123"}
        )
        
        assert response.status_code == 422

    async def test_register_password_too_long(self, client: AsyncClient):
        """Test registering with password too long."""
        response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "1234567"}
        )
        
        assert response.status_code == 422

    async def test_register_username_empty(self, client: AsyncClient):
        """Test registering with empty username."""
        response = await client.post(
            "/api/auth/register",
            json={"username": "", "password": "123456"}
        )
        
        assert response.status_code == 422

    async def test_register_with_different_valid_passwords(self, client: AsyncClient):
        """Test registering with various valid password lengths."""
        for password in ["1234", "12345", "123456"]:
            response = await client.post(
                "/api/auth/register",
                json={"username": f"user_{password}", "password": password}
            )
            
            assert response.status_code == 201
            data = response.json()
            assert data["token"] is not None


class TestAuthLoginEndpoint:
    """Test user login endpoint."""

    async def test_login_success(self, client: AsyncClient):
        """Test successful login."""
        # Register first
        await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        
        # Login
        response = await client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "123456"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"
        assert data["user_id"] is not None
        assert data["token"] is not None

    async def test_login_wrong_password(self, client: AsyncClient):
        """Test login with wrong password."""
        # Register first
        await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        
        # Try to login with wrong password
        response = await client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "654321"}
        )
        
        assert response.status_code == 401
        data = response.json()
        assert "incorrect" in data["detail"]

    async def test_login_nonexistent_user(self, client: AsyncClient):
        """Test login with non-existent user."""
        response = await client.post(
            "/api/auth/login",
            json={"username": "nonexistent", "password": "123456"}
        )
        
        assert response.status_code == 401
        data = response.json()
        assert "incorrect" in data["detail"]

    async def test_login_empty_password(self, client: AsyncClient):
        """Test login with empty password."""
        await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        
        response = await client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": ""}
        )
        
        assert response.status_code == 422


class TestAuthMeEndpoint:
    """Test current user endpoint."""

    async def test_me_success(self, client: AsyncClient):
        """Test getting current user with valid token."""
        # Register and get token
        register_response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        token = register_response.json()["token"]
        
        # Get current user
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"
        assert data["user_id"] is not None
        assert data["token"] == token

    async def test_me_invalid_token(self, client: AsyncClient):
        """Test getting current user with invalid token."""
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid-token"}
        )
        
        assert response.status_code == 401

    async def test_me_missing_authorization(self, client: AsyncClient):
        """Test getting current user without authorization header."""
        response = await client.get("/api/auth/me")
        
        assert response.status_code == 422  # Missing required header

    async def test_me_invalid_authorization_format(self, client: AsyncClient):
        """Test with invalid authorization header format."""
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "InvalidToken"}
        )
        
        assert response.status_code == 401

    async def test_me_bearer_lowercase(self, client: AsyncClient):
        """Test with lowercase 'bearer' prefix."""
        # Register and get token
        register_response = await client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "123456"}
        )
        token = register_response.json()["token"]
        
        # Get current user with lowercase bearer
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"bearer {token}"}
        )
        
        assert response.status_code == 200


class TestAuthFlow:
    """Test complete authentication flows."""

    async def test_register_login_validate_flow(self, client: AsyncClient):
        """Test complete register -> login -> validate flow."""
        # Register
        register_response = await client.post(
            "/api/auth/register",
            json={"username": "alice", "password": "111111"}
        )
        assert register_response.status_code == 201
        register_data = register_response.json()
        user_id = register_data["user_id"]
        
        # Login
        login_response = await client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "111111"}
        )
        assert login_response.status_code == 200
        login_data = login_response.json()
        token = login_data["token"]
        
        # Get current user to validate token
        me_response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert me_response.status_code == 200
        me_data = me_response.json()
        
        assert me_data["user_id"] == user_id
        assert me_data["username"] == "alice"

    async def test_multiple_users(self, client: AsyncClient):
        """Test authentication with multiple users."""
        # Register user 1
        user1_register = await client.post(
            "/api/auth/register",
            json={"username": "alice", "password": "111111"}
        )
        user1_data = user1_register.json()
        user1_token = user1_data["token"]
        user1_id = user1_data["user_id"]
        
        # Register user 2
        user2_register = await client.post(
            "/api/auth/register",
            json={"username": "bob", "password": "222222"}
        )
        user2_data = user2_register.json()
        user2_token = user2_data["token"]
        user2_id = user2_data["user_id"]
        
        # Verify user 1's token
        user1_me = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {user1_token}"}
        )
        assert user1_me.json()["user_id"] == user1_id
        
        # Verify user 2's token
        user2_me = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {user2_token}"}
        )
        assert user2_me.json()["user_id"] == user2_id
        
        # Verify tokens are different
        assert user1_token != user2_token

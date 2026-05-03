"""Tests for Lobby Service."""

import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player, Lobby, GameAction
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


class TestLobbyServiceCreate:
    """Test lobby creation functionality."""

    async def test_create_lobby_generates_unique_code(self, db_session: AsyncSession):
        """Test that creating a lobby generates a unique 6-character code."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        assert lobby is not None
        assert len(lobby.code) == 6
        assert lobby.code.isalnum()
        assert lobby.code.isupper()

    async def test_create_lobby_sets_active_status(self, db_session: AsyncSession):
        """Test that new lobbies have active status."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        assert lobby.status == "active"

    async def test_create_lobby_sets_expiration(self, db_session: AsyncSession):
        """Test that new lobbies have expiration set to 24 hours."""
        from app.services.lobby import LobbyService
        
        before = datetime.now(timezone.utc) + timedelta(hours=24)
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        after = datetime.now(timezone.utc) + timedelta(hours=24)
        
        assert before <= lobby.expires_at <= after

    async def test_create_lobby_persists_to_database(self, db_session: AsyncSession):
        """Test that created lobby is persisted to database."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Query from database
        result = await db_session.execute(
            select(Lobby).where(Lobby.id == lobby.id)
        )
        db_lobby = result.scalar_one()
        
        assert db_lobby.id == lobby.id
        assert db_lobby.code == lobby.code

    async def test_create_multiple_lobbies_unique_codes(self, db_session: AsyncSession):
        """Test that multiple lobbies get unique codes."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobbies = []
        
        for _ in range(10):
            lobby = await service.create_lobby()
            lobbies.append(lobby)
        
        codes = [lobby.code for lobby in lobbies]
        assert len(codes) == len(set(codes))  # All codes are unique

    async def test_create_lobby_with_custom_expiration(self, db_session: AsyncSession):
        """Test creating lobby with custom expiration time."""
        from app.services.lobby import LobbyService
        
        custom_expiration = datetime.now(timezone.utc) + timedelta(hours=48)
        service = LobbyService(db_session)
        lobby = await service.create_lobby(expires_at=custom_expiration)
        
        assert abs((lobby.expires_at - custom_expiration).total_seconds()) < 1


class TestLobbyServiceGet:
    """Test lobby retrieval functionality."""

    async def test_get_lobby_by_code(self, db_session: AsyncSession):
        """Test retrieving lobby by code."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        created_lobby = await service.create_lobby()
        
        # Get by code
        found_lobby = await service.get_lobby_by_code(created_lobby.code)
        
        assert found_lobby is not None
        assert found_lobby.id == created_lobby.id
        assert found_lobby.code == created_lobby.code

    async def test_get_lobby_by_code_not_found(self, db_session: AsyncSession):
        """Test getting non-existent lobby returns None."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.get_lobby_by_code("NOTFND")
        
        assert lobby is None

    async def test_get_lobby_by_id(self, db_session: AsyncSession):
        """Test retrieving lobby by ID."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        created_lobby = await service.create_lobby()
        
        # Get by ID
        found_lobby = await service.get_lobby_by_id(created_lobby.id)
        
        assert found_lobby is not None
        assert found_lobby.id == created_lobby.id

    async def test_get_lobby_by_id_not_found(self, db_session: AsyncSession):
        """Test getting non-existent lobby by ID returns None."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.get_lobby_by_id("00000000-0000-0000-0000-000000000000")
        
        assert lobby is None

    async def test_get_active_lobbies(self, db_session: AsyncSession):
        """Test retrieving all active lobbies."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create multiple lobbies
        lobby1 = await service.create_lobby()
        lobby2 = await service.create_lobby()
        lobby3 = await service.create_lobby()
        
        # Mark one as completed
        await service.close_lobby(lobby2.id)
        
        # Get active lobbies
        active_lobbies = await service.get_active_lobbies()
        active_ids = [lobby.id for lobby in active_lobbies]
        
        assert len(active_lobbies) >= 2
        assert lobby1.id in active_ids
        assert lobby3.id in active_ids
        assert lobby2.id not in active_ids


class TestLobbyServicePlayers:
    """Test player management in lobbies."""

    async def test_add_player_to_lobby(self, db_session: AsyncSession):
        """Test adding a player to a lobby."""
        from app.services.lobby import LobbyService
        
        # Create player and lobby
        player = Player(username="testplayer")
        db_session.add(player)
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add player to lobby
        result = await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        assert result is True

    async def test_add_player_creates_join_action(self, db_session: AsyncSession):
        """Test that adding player creates a join action."""
        from app.services.lobby import LobbyService
        
        player = Player(username="testplayer")
        db_session.add(player)
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Check for join action
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "join"
            )
        )
        join_action = result.scalar_one_or_none()
        
        assert join_action is not None
        assert join_action.action_type == "join"

    async def test_add_player_to_nonexistent_lobby(self, db_session: AsyncSession):
        """Test adding player to non-existent lobby fails."""
        from app.services.lobby import LobbyService
        
        player = Player(username="testplayer")
        db_session.add(player)
        await db_session.commit()
        
        service = LobbyService(db_session)
        result = await service.add_player_to_lobby(
            "00000000-0000-0000-0000-000000000000",
            player.id,
            player.username
        )
        
        assert result is False

    async def test_add_duplicate_player_to_lobby(self, db_session: AsyncSession):
        """Test that adding same player twice is idempotent."""
        from app.services.lobby import LobbyService
        
        player = Player(username="testplayer")
        db_session.add(player)
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add player twice
        result1 = await service.add_player_to_lobby(lobby.id, player.id, player.username)
        result2 = await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        assert result1 is True
        assert result2 is True
        
        # Should only have one join action
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "join"
            )
        )
        join_actions = result.scalars().all()
        assert len(join_actions) == 1

    async def test_get_lobby_players(self, db_session: AsyncSession):
        """Test getting all players in a lobby."""
        from app.services.lobby import LobbyService
        
        # Create players
        player1 = Player(username="player1")
        player2 = Player(username="player2")
        player3 = Player(username="player3")
        db_session.add_all([player1, player2, player3])
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add players
        await service.add_player_to_lobby(lobby.id, player1.id, player1.username)
        await service.add_player_to_lobby(lobby.id, player2.id, player2.username)
        await service.add_player_to_lobby(lobby.id, player3.id, player3.username)
        
        # Get players
        players = await service.get_lobby_players(lobby.id)
        player_ids = [p.id for p in players]
        
        assert len(players) == 3
        assert player1.id in player_ids
        assert player2.id in player_ids
        assert player3.id in player_ids

    async def test_get_lobby_player_count(self, db_session: AsyncSession):
        """Test getting player count in lobby."""
        from app.services.lobby import LobbyService
        
        # Create players
        players = [Player(username=f"player{i}") for i in range(5)]
        db_session.add_all(players)
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add players
        for player in players:
            await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Get count
        count = await service.get_lobby_player_count(lobby.id)
        
        assert count == 5

    async def test_remove_player_from_lobby(self, db_session: AsyncSession):
        """Test removing a player from lobby."""
        from app.services.lobby import LobbyService
        
        player = Player(username="testplayer")
        db_session.add(player)
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add then remove player
        await service.add_player_to_lobby(lobby.id, player.id, player.username)
        result = await service.remove_player_from_lobby(lobby.id, player.id)
        
        assert result is True
        
        # Verify player count
        count = await service.get_lobby_player_count(lobby.id)
        assert count == 0

    async def test_remove_player_creates_leave_action(self, db_session: AsyncSession):
        """Test that removing player creates a leave action."""
        from app.services.lobby import LobbyService
        
        player = Player(username="testplayer")
        db_session.add(player)
        await db_session.commit()
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        await service.add_player_to_lobby(lobby.id, player.id, player.username)
        await service.remove_player_from_lobby(lobby.id, player.id)
        
        # Check for leave action
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "leave"
            )
        )
        leave_action = result.scalar_one_or_none()
        
        assert leave_action is not None
        assert leave_action.action_type == "leave"

    async def test_check_lobby_at_capacity(self, db_session: AsyncSession):
        """Test checking if lobby is at max capacity."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add max players (10)
        for i in range(10):
            player = Player(username=f"player{i}")
            db_session.add(player)
            await db_session.commit()
            await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Check if at capacity
        is_full = await service.is_lobby_full(lobby.id)
        assert is_full is True

    async def test_cannot_add_player_to_full_lobby(self, db_session: AsyncSession):
        """Test that adding player to full lobby fails."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add max players
        for i in range(10):
            player = Player(username=f"player{i}")
            db_session.add(player)
            await db_session.commit()
            await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Try to add 11th player
        extra_player = Player(username="extra")
        db_session.add(extra_player)
        await db_session.commit()
        
        result = await service.add_player_to_lobby(lobby.id, extra_player.id, extra_player.username)
        assert result is False


class TestLobbyServiceStatus:
    """Test lobby status management."""

    async def test_close_lobby(self, db_session: AsyncSession):
        """Test closing a lobby."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        result = await service.close_lobby(lobby.id)
        
        assert result is True
        
        # Verify status changed
        updated_lobby = await service.get_lobby_by_id(lobby.id)
        assert updated_lobby.status == "completed"

    async def test_close_nonexistent_lobby(self, db_session: AsyncSession):
        """Test closing non-existent lobby fails."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        result = await service.close_lobby("00000000-0000-0000-0000-000000000000")
        
        assert result is False

    async def test_is_lobby_active(self, db_session: AsyncSession):
        """Test checking if lobby is active."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        is_active = await service.is_lobby_active(lobby.id)
        assert is_active is True
        
        # Close lobby
        await service.close_lobby(lobby.id)
        
        is_active = await service.is_lobby_active(lobby.id)
        assert is_active is False

    async def test_is_lobby_expired(self, db_session: AsyncSession):
        """Test checking if lobby is expired."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create expired lobby
        past_time = datetime.now(timezone.utc) - timedelta(hours=1)
        lobby = await service.create_lobby(expires_at=past_time)
        
        is_expired = await service.is_lobby_expired(lobby.id)
        assert is_expired is True

    async def test_cleanup_expired_lobbies(self, db_session: AsyncSession):
        """Test cleaning up expired lobbies."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create expired and active lobbies
        past_time = datetime.now(timezone.utc) - timedelta(hours=1)
        future_time = datetime.now(timezone.utc) + timedelta(hours=24)
        
        expired_lobby = await service.create_lobby(expires_at=past_time)
        active_lobby = await service.create_lobby(expires_at=future_time)
        
        # Cleanup
        cleaned_count = await service.cleanup_expired_lobbies()
        
        assert cleaned_count >= 1
        
        # Verify expired lobby is closed
        expired = await service.get_lobby_by_id(expired_lobby.id)
        assert expired.status == "completed"
        
        # Verify active lobby is still active
        active = await service.get_lobby_by_id(active_lobby.id)
        assert active.status == "active"


class TestLobbyServiceValidation:
    """Test lobby validation."""

    async def test_validate_lobby_code_format(self):
        """Test validating lobby code format."""
        from app.services.lobby import LobbyService
        
        # Valid codes
        assert LobbyService.is_valid_code("ABC123") is True
        assert LobbyService.is_valid_code("GAME01") is True
        assert LobbyService.is_valid_code("XXXXXX") is True
        
        # Invalid codes
        assert LobbyService.is_valid_code("abc123") is False  # lowercase
        assert LobbyService.is_valid_code("AB123") is False   # too short
        assert LobbyService.is_valid_code("ABC1234") is False # too long
        assert LobbyService.is_valid_code("ABC-12") is False  # special char
        assert LobbyService.is_valid_code("") is False        # empty

    async def test_lobby_exists(self, db_session: AsyncSession):
        """Test checking if lobby exists."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        exists = await service.lobby_exists(lobby.code)
        assert exists is True
        
        exists = await service.lobby_exists("NOTFND")
        assert exists is False


class TestLobbyServiceIntegration:
    """Integration tests for lobby service."""

    async def test_complete_lobby_lifecycle(self, db_session: AsyncSession):
        """Test complete lobby lifecycle from creation to closure."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # 1. Create lobby
        lobby = await service.create_lobby()
        assert lobby.status == "active"
        
        # 2. Add players
        players = []
        for i in range(3):
            player = Player(username=f"player{i}")
            db_session.add(player)
            await db_session.commit()
            players.append(player)
            
            await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # 3. Verify players
        player_count = await service.get_lobby_player_count(lobby.id)
        assert player_count == 3
        
        # 4. Remove a player
        await service.remove_player_from_lobby(lobby.id, players[0].id)
        player_count = await service.get_lobby_player_count(lobby.id)
        assert player_count == 2
        
        # 5. Close lobby
        await service.close_lobby(lobby.id)
        is_active = await service.is_lobby_active(lobby.id)
        assert is_active is False

    async def test_multiple_lobbies_concurrent(self, db_session: AsyncSession):
        """Test managing multiple lobbies concurrently."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create multiple lobbies
        lobbies = []
        for _ in range(5):
            lobby = await service.create_lobby()
            lobbies.append(lobby)
        
        # Add different players to each
        for i, lobby in enumerate(lobbies):
            for j in range(3):
                player = Player(username=f"lobby{i}_player{j}")
                db_session.add(player)
                await db_session.commit()
                await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Verify each lobby has 3 players
        for lobby in lobbies:
            count = await service.get_lobby_player_count(lobby.id)
            assert count == 3
        
        # Get all active lobbies
        active = await service.get_active_lobbies()
        assert len(active) >= 5

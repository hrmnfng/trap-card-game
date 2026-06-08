"""Tests for Lobby Service."""

import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player, Lobby, GameAction


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

    async def test_create_lobby_sets_waiting_status(self, db_session: AsyncSession):
        """Test that new lobbies have waiting status."""
        from app.services.lobby import LobbyService
        from app.models.database import LobbyStatus
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        assert lobby.status == LobbyStatus.WAITING.value

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
        player = Player(username="testplayer", password_hash="dummy_hash")
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
        
        player = Player(username="testplayer", password_hash="dummy_hash")
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
        
        player = Player(username="testplayer", password_hash="dummy_hash")
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
        
        player = Player(username="testplayer", password_hash="dummy_hash")
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
        player1 = Player(username="player1", password_hash="dummy_hash")
        player2 = Player(username="player2", password_hash="dummy_hash")
        player3 = Player(username="player3", password_hash="dummy_hash")
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
        
        player = Player(username="testplayer", password_hash="dummy_hash")
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
        
        player = Player(username="testplayer", password_hash="dummy_hash")
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
        extra_player = Player(username="extra", password_hash="dummy_hash")
        db_session.add(extra_player)
        await db_session.commit()
        
        result = await service.add_player_to_lobby(lobby.id, extra_player.id, extra_player.username)
        assert result is False


class TestLobbyServiceStatus:
    """Test lobby status management."""

    async def test_close_lobby(self, db_session: AsyncSession):
        """Test closing a lobby."""
        from app.services.lobby import LobbyService
        from app.models.database import LobbyStatus
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        result = await service.close_lobby(lobby.id)
        
        assert result is True
        
        # Verify status changed
        updated_lobby = await service.get_lobby_by_id(lobby.id)
        assert updated_lobby.status == LobbyStatus.CONCLUDED.value

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
        from app.models.database import LobbyStatus
        
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
        assert expired.status == LobbyStatus.CONCLUDED.value
        
        # Verify active lobby is still waiting
        active = await service.get_lobby_by_id(active_lobby.id)
        assert active.status == LobbyStatus.WAITING.value


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
        from app.models.database import LobbyStatus
        
        service = LobbyService(db_session)
        
        # 1. Create lobby
        lobby = await service.create_lobby()
        assert lobby.status == LobbyStatus.WAITING.value
        
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


class TestLobbyOwnership:
    """Test lobby ownership functionality."""

    async def test_first_player_becomes_owner(self, db_session: AsyncSession):
        """Test that the first player to join becomes the lobby owner."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add first player
        player1 = Player(username="Player1", password_hash="dummy_hash")
        db_session.add(player1)
        await db_session.commit()
        await db_session.refresh(player1)
        
        success = await service.add_player_to_lobby(lobby.id, player1.id, "Player1")
        assert success
        
        # Check that lobby now has an owner
        await db_session.refresh(lobby)
        assert lobby.owner_id == player1.id
    
    async def test_second_player_is_not_owner(self, db_session: AsyncSession):
        """Test that subsequent players don't become owners."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add first player
        player1 = Player(username="Player1", password_hash="dummy_hash")
        db_session.add(player1)
        await db_session.commit()
        await db_session.refresh(player1)
        
        await service.add_player_to_lobby(lobby.id, player1.id, "Player1")
        
        # Add second player
        player2 = Player(username="Player2", password_hash="dummy_hash")
        db_session.add(player2)
        await db_session.commit()
        await db_session.refresh(player2)
        
        await service.add_player_to_lobby(lobby.id, player2.id, "Player2")
        
        # Check that lobby owner is still player1
        await db_session.refresh(lobby)
        assert lobby.owner_id == player1.id
    
    async def test_check_is_owner(self, db_session: AsyncSession):
        """Test checking if a player is the lobby owner."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add players
        player1 = Player(username="Player1", password_hash="dummy_hash")
        player2 = Player(username="Player2", password_hash="dummy_hash")
        db_session.add_all([player1, player2])
        await db_session.commit()
        await db_session.refresh(player1)
        await db_session.refresh(player2)
        
        await service.add_player_to_lobby(lobby.id, player1.id, "Player1")
        await service.add_player_to_lobby(lobby.id, player2.id, "Player2")
        
        # Check ownership
        assert await service.is_lobby_owner(lobby.id, player1.id) is True
        assert await service.is_lobby_owner(lobby.id, player2.id) is False


class TestLobbyStatusUpdate:
    """Test lobby status update functionality."""

    async def test_update_lobby_status_to_in_progress(self, db_session: AsyncSession):
        """Test updating lobby status to in-progress."""
        from app.services.lobby import LobbyService
        from app.models.database import LobbyStatus
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        result = await service.update_lobby_status(lobby.id, LobbyStatus.IN_PROGRESS)
        
        assert result is True
        
        # Verify status changed
        updated_lobby = await service.get_lobby_by_id(lobby.id)
        assert updated_lobby.status == LobbyStatus.IN_PROGRESS.value

    async def test_update_lobby_status_to_concluded(self, db_session: AsyncSession):
        """Test updating lobby status to concluded."""
        from app.services.lobby import LobbyService
        from app.models.database import LobbyStatus
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        result = await service.update_lobby_status(lobby.id, LobbyStatus.CONCLUDED)
        
        assert result is True
        
        # Verify status changed
        updated_lobby = await service.get_lobby_by_id(lobby.id)
        assert updated_lobby.status == LobbyStatus.CONCLUDED.value

    async def test_update_nonexistent_lobby_status(self, db_session: AsyncSession):
        """Test updating non-existent lobby status fails."""
        from app.services.lobby import LobbyService
        from app.models.database import LobbyStatus
        
        service = LobbyService(db_session)
        result = await service.update_lobby_status(
            "00000000-0000-0000-0000-000000000000",
            LobbyStatus.IN_PROGRESS
        )
        
        assert result is False


class TestPlayerLobbyHistory:
    """Test player lobby history functionality."""

    async def test_get_player_lobby_history_empty(self, db_session: AsyncSession):
        """Test getting lobby history for player with no lobbies."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        player = Player(username="player1", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        
        history = await service.get_player_lobby_history(player.id)
        
        assert history == []

    async def test_get_player_lobby_history_single_lobby(self, db_session: AsyncSession):
        """Test getting lobby history for player with one lobby."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create player and lobby
        player = Player(username="player1", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        lobby = await service.create_lobby()
        
        # Add player to lobby
        await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Get history
        history = await service.get_player_lobby_history(player.id)
        
        assert len(history) == 1
        assert history[0]['code'] == lobby.code
        assert history[0]['player_count'] == 1

    async def test_get_player_lobby_history_multiple_lobbies(self, db_session: AsyncSession):
        """Test getting lobby history for player with multiple lobbies."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create player
        player = Player(username="player1", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        # Create and join multiple lobbies
        lobbies = []
        for _ in range(3):
            lobby = await service.create_lobby()
            lobbies.append(lobby)
            await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Get history
        history = await service.get_player_lobby_history(player.id)
        
        assert len(history) == 3
        history_codes = [item['code'] for item in history]
        for lobby in lobbies:
            assert lobby.code in history_codes

    async def test_get_player_lobby_history_ordered_by_recent(self, db_session: AsyncSession):
        """Test that lobby history is ordered by most recent first."""
        from app.services.lobby import LobbyService
        import time
        
        service = LobbyService(db_session)
        
        # Create player
        player = Player(username="player1", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        # Create and join lobbies with small delay
        codes = []
        for _ in range(3):
            lobby = await service.create_lobby()
            codes.append(lobby.code)
            await service.add_player_to_lobby(lobby.id, player.id, player.username)
            time.sleep(0.1)  # Small delay to ensure different timestamps
        
        # Get history
        history = await service.get_player_lobby_history(player.id)
        
        # Should be in reverse order (most recent first)
        history_codes = [item['code'] for item in history]
        assert history_codes[0] == codes[-1]  # Most recent

    async def test_lobby_history_includes_owner_info(self, db_session: AsyncSession):
        """Test that lobby history includes owner information."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        
        # Create players
        owner = Player(username="owner", password_hash="dummy_hash")
        player = Player(username="player1", password_hash="dummy_hash")
        db_session.add_all([owner, player])
        await db_session.commit()
        await db_session.refresh(owner)
        await db_session.refresh(player)
        
        # Create lobby and add owner first
        lobby = await service.create_lobby()
        await service.add_player_to_lobby(lobby.id, owner.id, owner.username)
        await service.add_player_to_lobby(lobby.id, player.id, player.username)
        
        # Get history for player
        history = await service.get_player_lobby_history(player.id)
        
        assert len(history) == 1
        assert history[0]['owner_username'] == owner.username
        assert history[0]['player_count'] == 2


class TestUniqueUsernames:
    """Test unique username enforcement."""

    async def test_duplicate_username_rejected(self, db_session: AsyncSession):
        """Test that duplicate usernames in the same lobby are rejected."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add first player with username "Alice"
        player1 = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player1)
        await db_session.commit()
        await db_session.refresh(player1)
        
        success = await service.add_player_to_lobby(lobby.id, player1.id, "Alice")
        assert success
        
        # Try to add second player with same username
        player2 = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player2)
        await db_session.commit()
        await db_session.refresh(player2)
        
        # This should fail
        success = await service.add_player_to_lobby(lobby.id, player2.id, "Alice")
        assert success is False
    
    async def test_duplicate_username_different_lobbies_allowed(self, db_session: AsyncSession):
        """Test that the same username can be used in different lobbies."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby1 = await service.create_lobby()
        lobby2 = await service.create_lobby()
        
        # Add player with username "Alice" to lobby1
        player1 = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player1)
        await db_session.commit()
        await db_session.refresh(player1)
        
        success1 = await service.add_player_to_lobby(lobby1.id, player1.id, "Alice")
        assert success1
        
        # Add different player with same username to lobby2
        player2 = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player2)
        await db_session.commit()
        await db_session.refresh(player2)
        
        success2 = await service.add_player_to_lobby(lobby2.id, player2.id, "Alice")
        assert success2
    
    async def test_case_insensitive_username_check(self, db_session: AsyncSession):
        """Test that username uniqueness check is case-insensitive."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # Add first player with username "Alice"
        player1 = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player1)
        await db_session.commit()
        await db_session.refresh(player1)
        
        success = await service.add_player_to_lobby(lobby.id, player1.id, "Alice")
        assert success
        
        # Try to add second player with "alice" (different case)
        player2 = Player(username="alice", password_hash="dummy_hash")
        db_session.add(player2)
        await db_session.commit()
        await db_session.refresh(player2)
        
        # This should fail due to case-insensitive check
        success = await service.add_player_to_lobby(lobby.id, player2.id, "alice")
        assert success is False


class TestPlayerProvisioningArchitecture:
    """Test the separation of join and card provisioning logic."""

    async def test_is_player_new_to_lobby_returns_true_for_new_player(self, db_session: AsyncSession):
        """Test that _is_player_new_to_lobby returns True for a player who never joined."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        player = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        # Player hasn't joined yet
        is_new = await service._is_player_new_to_lobby(lobby.id, player.id)
        assert is_new is True

    async def test_is_player_new_to_lobby_returns_false_for_existing_player(self, db_session: AsyncSession):
        """Test that _is_player_new_to_lobby returns False for a player who already joined."""
        from app.services.lobby import LobbyService
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        player = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        # Player joins for the first time
        await service.add_player_to_lobby(lobby.id, player.id, "Alice")
        
        # Now check - should be False (not new anymore)
        is_new = await service._is_player_new_to_lobby(lobby.id, player.id)
        assert is_new is False

    async def test_provision_new_player_cards_deals_three_cards(self, db_session: AsyncSession):
        """Test that provision_new_player_cards deals exactly 3 cards."""
        from app.services.lobby import LobbyService
        from app.models.database import GameAction
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        player = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        # Provision cards
        success = await service.provision_new_player_cards(lobby.id, player.id)
        assert success is True
        
        # Check that exactly 3 distribute actions were created
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "distribute"
            )
        )
        actions = result.scalars().all()
        assert len(actions) == 3
        
        # Check that each card has a valid value
        for action in actions:
            assert action.card_value is not None
            assert 1 <= action.card_value <= 10  # Based on default settings

    async def test_rejoin_player_does_not_get_new_cards(self, db_session: AsyncSession):
        """Test that a player who rejoins doesn't get new cards provisioned."""
        from app.services.lobby import LobbyService
        from app.models.database import GameAction
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        player = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        
        # First join: player joins and gets cards
        is_new = await service._is_player_new_to_lobby(lobby.id, player.id)
        assert is_new is True
        
        await service.add_player_to_lobby(lobby.id, player.id, "Alice")
        await service.provision_new_player_cards(lobby.id, player.id)
        
        # Verify player has 3 cards
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "distribute"
            )
        )
        initial_actions = result.scalars().all()
        assert len(initial_actions) == 3
        
        # Second join (rejoin): player rejoins
        is_new = await service._is_player_new_to_lobby(lobby.id, player.id)
        assert is_new is False  # Not a new player anymore
        
        await service.add_player_to_lobby(lobby.id, player.id, "Alice")
        # Don't provision cards - player is not new
        
        # Verify player still has exactly 3 cards (no new ones dealt)
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "distribute"
            )
        )
        final_actions = result.scalars().all()
        assert len(final_actions) == 3  # Same as before

    async def test_new_player_joining_midgame_gets_provisioned(self, db_session: AsyncSession):
        """Test that a truly new player joining an in-progress game gets cards provisioned."""
        from app.services.lobby import LobbyService
        from app.models.database import LobbyStatus, GameAction
        
        service = LobbyService(db_session)
        lobby = await service.create_lobby()
        
        # First player joins
        player1 = Player(username="Alice", password_hash="dummy_hash")
        db_session.add(player1)
        await db_session.commit()
        await db_session.refresh(player1)
        
        await service.add_player_to_lobby(lobby.id, player1.id, "Alice")
        
        # Start game (change status to in-progress)
        lobby.status = LobbyStatus.IN_PROGRESS.value
        db_session.add(lobby)
        await db_session.commit()
        
        # Second player joins (truly new to lobby)
        player2 = Player(username="Bob", password_hash="dummy_hash")
        db_session.add(player2)
        await db_session.commit()
        await db_session.refresh(player2)
        
        is_new = await service._is_player_new_to_lobby(lobby.id, player2.id)
        assert is_new is True
        
        # Player2 should get provisioned
        await service.add_player_to_lobby(lobby.id, player2.id, "Bob")
        await service.provision_new_player_cards(lobby.id, player2.id)
        
        # Verify player2 has 3 cards
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby.id,
                GameAction.player_id == player2.id,
                GameAction.action_type == "distribute"
            )
        )
        actions = result.scalars().all()
        assert len(actions) == 3

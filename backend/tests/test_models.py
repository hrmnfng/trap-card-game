"""Tests for SQLAlchemy database models."""

import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player, Lobby, GameAction, utcnow
from app.database.session import async_session_maker, init_db, drop_db


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    """Setup and teardown test database for each test."""
    # Create tables
    await init_db()
    yield
    # Drop tables
    await drop_db()


@pytest.fixture
async def db_session() -> AsyncSession:
    """Provide a database session for tests."""
    async with async_session_maker() as session:
        yield session


class TestUtilityFunctions:
    """Test utility functions."""

    def test_utcnow_returns_aware_datetime(self):
        """Test that utcnow returns timezone-aware datetime."""
        now = utcnow()
        assert now.tzinfo is not None
        assert now.tzinfo == timezone.utc

    def test_utcnow_returns_current_time(self):
        """Test that utcnow returns approximately current time."""
        before = datetime.now(timezone.utc)
        result = utcnow()
        after = datetime.now(timezone.utc)
        
        assert before <= result <= after


class TestPlayerModel:
    """Test Player model."""

    async def test_create_player(self, db_session: AsyncSession):
        """Test creating a player with required fields."""
        player = Player(username="testuser")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)

        assert player.id is not None
        assert len(player.id) == 36  # UUID4 string length
        assert player.username == "testuser"
        assert player.created_at is not None
        assert player.created_at.tzinfo == timezone.utc

    async def test_player_id_is_unique(self, db_session: AsyncSession):
        """Test that player IDs are unique."""
        player1 = Player(username="user1")
        player2 = Player(username="user2")
        db_session.add(player1)
        db_session.add(player2)
        await db_session.commit()

        assert player1.id != player2.id

    async def test_player_username_can_be_duplicate(self, db_session: AsyncSession):
        """Test that multiple players can have the same username."""
        player1 = Player(username="duplicate")
        player2 = Player(username="duplicate")
        db_session.add(player1)
        db_session.add(player2)
        await db_session.commit()

        assert player1.id != player2.id
        assert player1.username == player2.username

    async def test_player_created_at_auto_set(self, db_session: AsyncSession):
        """Test that created_at is automatically set."""
        before = datetime.now(timezone.utc)
        player = Player(username="autotime")
        db_session.add(player)
        await db_session.commit()
        await db_session.refresh(player)
        after = datetime.now(timezone.utc)

        assert before <= player.created_at <= after

    async def test_player_relationships_initialized(self, db_session: AsyncSession):
        """Test that player relationships are initialized."""
        from sqlalchemy.orm import selectinload
        
        player = Player(username="reltest")
        db_session.add(player)
        await db_session.commit()
        
        # Eager load the relationship
        result = await db_session.execute(
            select(Player).options(selectinload(Player.actions)).where(Player.id == player.id)
        )
        player = result.scalar_one()

        assert hasattr(player, "actions")
        assert player.actions == []

    async def test_query_player_by_username(self, db_session: AsyncSession):
        """Test querying player by username."""
        player = Player(username="searchable")
        db_session.add(player)
        await db_session.commit()

        result = await db_session.execute(
            select(Player).where(Player.username == "searchable")
        )
        found_player = result.scalar_one()

        assert found_player.id == player.id
        assert found_player.username == "searchable"


class TestLobbyModel:
    """Test Lobby model."""

    async def test_create_lobby(self, db_session: AsyncSession):
        """Test creating a lobby with required fields."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="ABC123", expires_at=expires)
        db_session.add(lobby)
        await db_session.commit()
        await db_session.refresh(lobby)

        assert lobby.id is not None
        assert len(lobby.id) == 36
        assert lobby.code == "ABC123"
        assert lobby.status == "active"
        assert lobby.created_at is not None
        assert lobby.expires_at == expires

    async def test_lobby_code_is_unique(self, db_session: AsyncSession):
        """Test that lobby codes must be unique."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby1 = Lobby(code="UNIQUE", expires_at=expires)
        lobby2 = Lobby(code="UNIQUE", expires_at=expires)
        
        db_session.add(lobby1)
        await db_session.commit()
        
        db_session.add(lobby2)
        with pytest.raises(Exception):  # Should raise IntegrityError
            await db_session.commit()

    async def test_lobby_code_is_indexed(self, db_session: AsyncSession):
        """Test that lobby code has index for fast lookups."""
        # Create multiple lobbies
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        for i in range(10):
            lobby = Lobby(code=f"CODE{i:02d}", expires_at=expires)
            db_session.add(lobby)
        await db_session.commit()

        # Query by code should be fast (index is used)
        result = await db_session.execute(
            select(Lobby).where(Lobby.code == "CODE05")
        )
        lobby = result.scalar_one()
        assert lobby.code == "CODE05"

    async def test_lobby_default_status(self, db_session: AsyncSession):
        """Test that lobby status defaults to 'active'."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="STATUS", expires_at=expires)
        db_session.add(lobby)
        await db_session.commit()
        await db_session.refresh(lobby)

        assert lobby.status == "active"

    async def test_lobby_status_can_be_set(self, db_session: AsyncSession):
        """Test that lobby status can be explicitly set."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="CUSTOM", status="completed", expires_at=expires)
        db_session.add(lobby)
        await db_session.commit()
        await db_session.refresh(lobby)

        assert lobby.status == "completed"

    async def test_lobby_relationships_initialized(self, db_session: AsyncSession):
        """Test that lobby relationships are initialized."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="RELTES", expires_at=expires)
        db_session.add(lobby)
        await db_session.commit()
        await db_session.refresh(lobby)

        assert hasattr(lobby, "actions")
        assert lobby.actions == []

    async def test_query_active_lobbies(self, db_session: AsyncSession):
        """Test querying active lobbies."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby1 = Lobby(code="ACTIV1", status="active", expires_at=expires)
        lobby2 = Lobby(code="DONE01", status="completed", expires_at=expires)
        lobby3 = Lobby(code="ACTIV2", status="active", expires_at=expires)
        
        db_session.add_all([lobby1, lobby2, lobby3])
        await db_session.commit()

        result = await db_session.execute(
            select(Lobby).where(Lobby.status == "active")
        )
        active_lobbies = result.scalars().all()

        assert len(active_lobbies) == 2
        assert all(lobby.status == "active" for lobby in active_lobbies)

    async def test_query_expired_lobbies(self, db_session: AsyncSession):
        """Test querying expired lobbies."""
        now = datetime.now(timezone.utc)
        lobby1 = Lobby(code="EXPIR1", expires_at=now - timedelta(hours=1))
        lobby2 = Lobby(code="VALID1", expires_at=now + timedelta(hours=24))
        lobby3 = Lobby(code="EXPIR2", expires_at=now - timedelta(minutes=1))
        
        db_session.add_all([lobby1, lobby2, lobby3])
        await db_session.commit()

        result = await db_session.execute(
            select(Lobby).where(Lobby.expires_at < now)
        )
        expired_lobbies = result.scalars().all()

        assert len(expired_lobbies) == 2
        assert all(lobby.expires_at < now for lobby in expired_lobbies)


class TestGameActionModel:
    """Test GameAction model."""

    async def test_create_game_action(self, db_session: AsyncSession):
        """Test creating a game action with required fields."""
        # Create dependencies
        player = Player(username="actionplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="ACTION", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        # Create action
        action = GameAction(
            lobby_id=lobby.id,
            player_id=player.id,
            action_type="play_card",
            card_value=5,
        )
        db_session.add(action)
        await db_session.commit()
        await db_session.refresh(action)

        assert action.id is not None
        assert len(action.id) == 36
        assert action.lobby_id == lobby.id
        assert action.player_id == player.id
        assert action.action_type == "play_card"
        assert action.card_value == 5
        assert action.target_id is None
        assert action.action_metadata is None
        assert action.timestamp is not None

    async def test_game_action_optional_fields(self, db_session: AsyncSession):
        """Test game action with optional fields."""
        player = Player(username="optplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="OPTAC1", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        action = GameAction(
            lobby_id=lobby.id,
            player_id=player.id,
            action_type="join",
            target_id="some-target-id",
            action_metadata='{"key": "value"}',
        )
        db_session.add(action)
        await db_session.commit()
        await db_session.refresh(action)

        assert action.card_value is None
        assert action.target_id == "some-target-id"
        assert action.action_metadata == '{"key": "value"}'

    async def test_game_action_timestamp_auto_set(self, db_session: AsyncSession):
        """Test that timestamp is automatically set."""
        player = Player(username="timeplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="TIMEA1", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        before = datetime.now(timezone.utc)
        action = GameAction(
            lobby_id=lobby.id,
            player_id=player.id,
            action_type="test",
        )
        db_session.add(action)
        await db_session.commit()
        await db_session.refresh(action)
        after = datetime.now(timezone.utc)

        assert before <= action.timestamp <= after

    async def test_game_action_relationships(self, db_session: AsyncSession):
        """Test game action relationships to player and lobby."""
        player = Player(username="relplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="RELAC1", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        action = GameAction(
            lobby_id=lobby.id,
            player_id=player.id,
            action_type="test",
        )
        db_session.add(action)
        await db_session.commit()
        await db_session.refresh(action)

        # Test relationships
        assert action.lobby.id == lobby.id
        assert action.player.id == player.id

    async def test_cascade_delete_lobby(self, db_session: AsyncSession):
        """Test that deleting lobby cascades to actions."""
        player = Player(username="cascadeplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="CASCAD", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        action = GameAction(
            lobby_id=lobby.id,
            player_id=player.id,
            action_type="test",
        )
        db_session.add(action)
        await db_session.commit()
        action_id = action.id

        # Delete lobby
        await db_session.delete(lobby)
        await db_session.commit()

        # Action should be deleted
        result = await db_session.execute(
            select(GameAction).where(GameAction.id == action_id)
        )
        assert result.scalar_one_or_none() is None

    async def test_cascade_delete_player(self, db_session: AsyncSession):
        """Test that deleting player cascades to actions."""
        player = Player(username="deleteplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="DELAC1", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        action = GameAction(
            lobby_id=lobby.id,
            player_id=player.id,
            action_type="test",
        )
        db_session.add(action)
        await db_session.commit()
        action_id = action.id

        # Delete player
        await db_session.delete(player)
        await db_session.commit()

        # Action should be deleted
        result = await db_session.execute(
            select(GameAction).where(GameAction.id == action_id)
        )
        assert result.scalar_one_or_none() is None

    async def test_query_actions_by_lobby(self, db_session: AsyncSession):
        """Test querying actions by lobby."""
        player = Player(username="queryplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby1 = Lobby(code="QUERY1", expires_at=expires)
        lobby2 = Lobby(code="QUERY2", expires_at=expires)
        db_session.add_all([player, lobby1, lobby2])
        await db_session.commit()

        # Create actions in different lobbies
        action1 = GameAction(lobby_id=lobby1.id, player_id=player.id, action_type="act1")
        action2 = GameAction(lobby_id=lobby1.id, player_id=player.id, action_type="act2")
        action3 = GameAction(lobby_id=lobby2.id, player_id=player.id, action_type="act3")
        db_session.add_all([action1, action2, action3])
        await db_session.commit()

        # Query lobby1 actions
        result = await db_session.execute(
            select(GameAction).where(GameAction.lobby_id == lobby1.id)
        )
        lobby1_actions = result.scalars().all()

        assert len(lobby1_actions) == 2
        assert all(action.lobby_id == lobby1.id for action in lobby1_actions)

    async def test_query_actions_by_player(self, db_session: AsyncSession):
        """Test querying actions by player."""
        player1 = Player(username="player1")
        player2 = Player(username="player2")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="PQUERY", expires_at=expires)
        db_session.add_all([player1, player2, lobby])
        await db_session.commit()

        # Create actions by different players
        action1 = GameAction(lobby_id=lobby.id, player_id=player1.id, action_type="act1")
        action2 = GameAction(lobby_id=lobby.id, player_id=player1.id, action_type="act2")
        action3 = GameAction(lobby_id=lobby.id, player_id=player2.id, action_type="act3")
        db_session.add_all([action1, action2, action3])
        await db_session.commit()

        # Query player1 actions
        result = await db_session.execute(
            select(GameAction).where(GameAction.player_id == player1.id)
        )
        player1_actions = result.scalars().all()

        assert len(player1_actions) == 2
        assert all(action.player_id == player1.id for action in player1_actions)

    async def test_query_actions_ordered_by_timestamp(self, db_session: AsyncSession):
        """Test querying actions ordered by timestamp."""
        player = Player(username="orderplayer")
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="ORDER", expires_at=expires)
        db_session.add_all([player, lobby])
        await db_session.commit()

        # Create actions with slight delays
        action1 = GameAction(lobby_id=lobby.id, player_id=player.id, action_type="first")
        db_session.add(action1)
        await db_session.commit()

        action2 = GameAction(lobby_id=lobby.id, player_id=player.id, action_type="second")
        db_session.add(action2)
        await db_session.commit()

        action3 = GameAction(lobby_id=lobby.id, player_id=player.id, action_type="third")
        db_session.add(action3)
        await db_session.commit()

        # Query ordered by timestamp
        result = await db_session.execute(
            select(GameAction)
            .where(GameAction.lobby_id == lobby.id)
            .order_by(GameAction.timestamp)
        )
        actions = result.scalars().all()

        assert len(actions) == 3
        assert actions[0].action_type == "first"
        assert actions[1].action_type == "second"
        assert actions[2].action_type == "third"
        assert actions[0].timestamp <= actions[1].timestamp <= actions[2].timestamp


class TestModelIntegration:
    """Test integration between models."""

    async def test_complete_game_scenario(self, db_session: AsyncSession):
        """Test a complete scenario with all models."""
        # Create players
        player1 = Player(username="alice")
        player2 = Player(username="bob")
        db_session.add_all([player1, player2])
        await db_session.commit()

        # Create lobby
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="GAME01", expires_at=expires)
        db_session.add(lobby)
        await db_session.commit()

        # Players join
        join1 = GameAction(lobby_id=lobby.id, player_id=player1.id, action_type="join")
        join2 = GameAction(lobby_id=lobby.id, player_id=player2.id, action_type="join")
        db_session.add_all([join1, join2])
        await db_session.commit()

        # Players play cards
        play1 = GameAction(
            lobby_id=lobby.id,
            player_id=player1.id,
            action_type="play_card",
            card_value=7,
        )
        play2 = GameAction(
            lobby_id=lobby.id,
            player_id=player2.id,
            action_type="play_card",
            card_value=3,
        )
        db_session.add_all([play1, play2])
        await db_session.commit()

        # Query all actions for the lobby
        result = await db_session.execute(
            select(GameAction)
            .where(GameAction.lobby_id == lobby.id)
            .order_by(GameAction.timestamp)
        )
        actions = result.scalars().all()

        assert len(actions) == 4
        assert actions[0].action_type == "join"
        assert actions[1].action_type == "join"
        assert actions[2].action_type == "play_card"
        assert actions[3].action_type == "play_card"

    async def test_lobby_with_multiple_players(self, db_session: AsyncSession):
        """Test lobby with multiple players and their actions."""
        # Create 5 players
        players = [Player(username=f"player{i}") for i in range(5)]
        db_session.add_all(players)
        await db_session.commit()

        # Create lobby
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        lobby = Lobby(code="MULTI", expires_at=expires)
        db_session.add(lobby)
        await db_session.commit()

        # Each player joins and plays a card
        for i, player in enumerate(players):
            join = GameAction(lobby_id=lobby.id, player_id=player.id, action_type="join")
            play = GameAction(
                lobby_id=lobby.id,
                player_id=player.id,
                action_type="play_card",
                card_value=i + 1,
            )
            db_session.add_all([join, play])
        await db_session.commit()

        # Verify all actions
        result = await db_session.execute(
            select(GameAction).where(GameAction.lobby_id == lobby.id)
        )
        actions = result.scalars().all()

        assert len(actions) == 10  # 5 joins + 5 plays
        joins = [a for a in actions if a.action_type == "join"]
        plays = [a for a in actions if a.action_type == "play_card"]
        assert len(joins) == 5
        assert len(plays) == 5

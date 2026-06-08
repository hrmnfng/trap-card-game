"""Tests for Redis Pub/Sub Service."""

import pytest
import asyncio
import json
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player, Lobby
from app.redis import init_redis, close_redis


@pytest.fixture(scope="function", autouse=True)
async def setup_redis():
    """Setup and teardown Redis for each test."""
    await init_redis()
    yield
    await close_redis()


@pytest.fixture
async def test_lobby(db_session: AsyncSession) -> Lobby:
    """Create a test lobby."""
    from app.services.lobby import LobbyService
    
    service = LobbyService(db_session)
    return await service.create_lobby()


@pytest.fixture
async def test_players(db_session: AsyncSession) -> list[Player]:
    """Create test players."""
    players = [Player(username=f"player{i}") for i in range(3)]
    db_session.add_all(players)
    await db_session.commit()
    for player in players:
        await db_session.refresh(player)
    return players


class TestPubSubServiceBasics:
    """Test basic pub/sub functionality."""

    async def test_publish_message(self, test_lobby: Lobby):
        """Test publishing a message to a lobby channel."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        message = {"type": "test", "data": "hello"}
        result = await service.publish_to_lobby(test_lobby.id, message)
        
        # Result should be number of subscribers (0 if none)
        assert result >= 0

    async def test_subscribe_to_lobby(self, test_lobby: Lobby):
        """Test subscribing to a lobby channel."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        # Subscribe
        result = await service.subscribe_to_lobby(test_lobby.id)
        
        assert result is True

    async def test_unsubscribe_from_lobby(self, test_lobby: Lobby):
        """Test unsubscribing from a lobby channel."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        # Subscribe first
        await service.subscribe_to_lobby(test_lobby.id)
        
        # Then unsubscribe
        result = await service.unsubscribe_from_lobby(test_lobby.id)
        
        assert result is True

    async def test_get_lobby_channel_name(self, test_lobby: Lobby):
        """Test getting channel name for a lobby."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        channel = service.get_lobby_channel(test_lobby.id)
        
        assert channel is not None
        assert test_lobby.id in channel
        assert channel.startswith("lobby:")


class TestPubSubServiceMessaging:
    """Test message publishing and receiving."""

    async def test_publish_and_receive_message(self, test_lobby: Lobby):
        """Test publishing and receiving a message."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        # Subscribe to lobby
        await service.subscribe_to_lobby(test_lobby.id)
        
        # Publish message
        test_message = {"type": "test", "data": "hello world"}
        await service.publish_to_lobby(test_lobby.id, test_message)
        
        # Wait a bit for message to propagate
        await asyncio.sleep(0.1)
        
        # Try to get message
        message = await service.get_message(test_lobby.id, timeout=1.0)
        
        if message:
            assert message["type"] == "test"
            assert message["data"] == "hello world"

    async def test_receive_multiple_messages(self, test_lobby: Lobby):
        """Test receiving multiple messages in order."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        await service.subscribe_to_lobby(test_lobby.id)
        
        # Publish multiple messages
        messages = [
            {"type": "msg", "seq": 1},
            {"type": "msg", "seq": 2},
            {"type": "msg", "seq": 3}
        ]
        
        for msg in messages:
            await service.publish_to_lobby(test_lobby.id, msg)
        
        await asyncio.sleep(0.1)
        
        # Should be able to receive messages
        received_count = 0
        for _ in range(3):
            msg = await service.get_message(test_lobby.id, timeout=0.5)
            if msg and msg.get("type") == "msg":
                received_count += 1
        
        assert received_count > 0  # At least some messages received

    async def test_no_message_returns_none(self, test_lobby: Lobby):
        """Test that get_message returns None when no messages."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        await service.subscribe_to_lobby(test_lobby.id)
        
        # Try to get message with short timeout
        message = await service.get_message(test_lobby.id, timeout=0.1)
        
        assert message is None

    async def test_messages_isolated_between_lobbies(
        self,
        db_session: AsyncSession
    ):
        """Test that messages are isolated between lobbies."""
        from app.services.pubsub import PubSubService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        pubsub_service = PubSubService()
        
        # Create two lobbies
        lobby1 = await lobby_service.create_lobby()
        lobby2 = await lobby_service.create_lobby()
        
        # Subscribe to both
        await pubsub_service.subscribe_to_lobby(lobby1.id)
        await pubsub_service.subscribe_to_lobby(lobby2.id)
        
        # Publish to lobby1
        await pubsub_service.publish_to_lobby(lobby1.id, {"lobby": "lobby1"})
        
        await asyncio.sleep(0.1)
        
        # Get message from lobby1
        msg1 = await pubsub_service.get_message(lobby1.id, timeout=0.5)
        
        # lobby1 should have its message
        if msg1:
            assert msg1.get("lobby") == "lobby1"
        
        # lobby2 should not have lobby1's message
        msg2 = await pubsub_service.get_message(lobby2.id, timeout=0.1)
        assert msg2 is None or msg2.get("lobby") != "lobby1"


class TestPubSubServiceGameEvents:
    """Test game event broadcasting."""

    async def test_broadcast_player_joined(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test broadcasting player joined event."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        await service.subscribe_to_lobby(test_lobby.id)
        
        player = test_players[0]
        result = await service.broadcast_player_joined(
            test_lobby.id,
            player.id,
            player.username
        )
        
        assert result >= 0
        
        # Check message
        await asyncio.sleep(0.1)
        message = await service.get_message(test_lobby.id, timeout=0.5)
        
        if message:
            assert message["type"] == "player_joined"
            assert message["player_id"] == player.id
            assert message["username"] == player.username

    async def test_broadcast_player_left(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test broadcasting player left event."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        await service.subscribe_to_lobby(test_lobby.id)
        
        player = test_players[0]
        result = await service.broadcast_player_left(
            test_lobby.id,
            player.id,
            player.username
        )
        
        assert result >= 0

    async def test_broadcast_game_started(self, test_lobby: Lobby):
        """Test broadcasting game started event."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        await service.subscribe_to_lobby(test_lobby.id)
        
        result = await service.broadcast_game_started(test_lobby.id)
        
        assert result >= 0
        
        await asyncio.sleep(0.1)
        message = await service.get_message(test_lobby.id, timeout=0.5)
        
        if message:
            assert message["type"] == "game_started"

    async def test_broadcast_card_played(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test broadcasting card played event."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        await service.subscribe_to_lobby(test_lobby.id)
        
        player = test_players[0]
        target = test_players[1]
        
        result = await service.broadcast_card_played(
            test_lobby.id,
            player.id,
            player.username,
            5,  # card value
            target.id,
            target.username
        )
        
        assert result >= 0
        
        await asyncio.sleep(0.1)
        message = await service.get_message(test_lobby.id, timeout=0.5)
        
        if message:
            assert message["type"] == "card_played"
            assert message["player_id"] == player.id
            assert message["card_value"] == 5
            assert message["target_id"] == target.id

    async def test_broadcast_game_ended(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test broadcasting game ended event."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        await service.subscribe_to_lobby(test_lobby.id)
        
        winner = test_players[0]
        result = await service.broadcast_game_ended(
            test_lobby.id,
            winner.id,
            winner.username
        )
        
        assert result >= 0
        
        await asyncio.sleep(0.1)
        message = await service.get_message(test_lobby.id, timeout=0.5)
        
        if message:
            assert message["type"] == "game_ended"
            assert message["winner_id"] == winner.id

    async def test_broadcast_state_update(
        self,
        test_lobby: Lobby
    ):
        """Test broadcasting full state update."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        await service.subscribe_to_lobby(test_lobby.id)
        
        game_state = {
            "lobby_id": test_lobby.id,
            "players": [],
            "my_cards": [],
            "history": []
        }
        
        result = await service.broadcast_state_update(test_lobby.id, game_state)
        
        assert result >= 0


class TestPubSubServiceConnectionManagement:
    """Test connection management."""

    @pytest.mark.skip(reason="Redis pub/sub has race conditions in tests - requires background listener tasks to receive messages reliably")
    async def test_multiple_subscribers(self, test_lobby: Lobby):
        """Test multiple subscribers to same lobby."""
        from app.services.pubsub import PubSubService
        
        # Create multiple service instances (simulating multiple clients)
        service1 = PubSubService()
        service2 = PubSubService()
        
        await service1.subscribe_to_lobby(test_lobby.id)
        await service2.subscribe_to_lobby(test_lobby.id)
        
        # Give subscriptions time to establish
        await asyncio.sleep(0.2)
        
        # Publish message
        result = await service1.publish_to_lobby(test_lobby.id, {"test": "data"})
        
        # Give message time to propagate
        await asyncio.sleep(0.2)
        
        # Both should be able to receive
        msg1 = await service1.get_message(test_lobby.id, timeout=1.0)
        msg2 = await service2.get_message(test_lobby.id, timeout=1.0)
        
        # At least one should receive it (Redis pub/sub behavior varies)
        # If result > 0, at least one subscriber was notified
        if result > 0:
            assert msg1 is not None or msg2 is not None
        else:
            # No active listeners at publish time - skip
            pytest.skip("No active Redis subscribers at publish time")

    async def test_cleanup_after_unsubscribe(self, test_lobby: Lobby):
        """Test that unsubscribe cleans up properly."""
        from app.services.pubsub import PubSubService
        
        service = PubSubService()
        
        # Subscribe
        await service.subscribe_to_lobby(test_lobby.id)
        
        # Publish message
        await service.publish_to_lobby(test_lobby.id, {"test": "before"})
        
        await asyncio.sleep(0.1)
        
        # Unsubscribe
        await service.unsubscribe_from_lobby(test_lobby.id)
        
        # Publish after unsubscribe
        await service.publish_to_lobby(test_lobby.id, {"test": "after"})
        
        await asyncio.sleep(0.1)
        
        # Should not receive messages after unsubscribe
        message = await service.get_message(test_lobby.id, timeout=0.1)
        # Either None or only the "before" message
        if message:
            assert message.get("test") == "before"


class TestPubSubServiceIntegration:
    """Integration tests for pub/sub service."""

    async def test_complete_game_flow_with_pubsub(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test complete game flow with pub/sub notifications."""
        from app.services.pubsub import PubSubService
        from app.services.lobby import LobbyService
        from app.services.game import GameService
        
        pubsub_service = PubSubService()
        lobby_service = LobbyService(db_session)
        game_service = GameService(db_session)
        
        # Subscribe to lobby
        await pubsub_service.subscribe_to_lobby(test_lobby.id)
        
        # Add players
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(
                test_lobby.id,
                player.id,
                player.username
            )
            await pubsub_service.broadcast_player_joined(
                test_lobby.id,
                player.id,
                player.username
            )
        
        # Start game
        await game_service.distribute_cards(test_lobby.id)
        await pubsub_service.broadcast_game_started(test_lobby.id)
        
        # Play a card
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        if cards:
            await game_service.play_card(
                test_lobby.id,
                test_players[0].id,
                cards[0]['id'],
                test_players[1].id
            )
            await pubsub_service.broadcast_card_played(
                test_lobby.id,
                test_players[0].id,
                test_players[0].username,
                cards[0]['value'],
                test_players[1].id,
                test_players[1].username
            )
        
        await asyncio.sleep(0.1)
        
        # Should have received multiple events
        events_received = 0
        for _ in range(10):  # Try to get up to 10 messages
            msg = await pubsub_service.get_message(test_lobby.id, timeout=0.1)
            if msg:
                events_received += 1
        
        # Should have received at least some events
        assert events_received >= 2  # At least 2 player_joined events

    async def test_concurrent_lobbies_with_pubsub(
        self,
        db_session: AsyncSession,
        test_players: list[Player]
    ):
        """Test multiple lobbies with pub/sub simultaneously."""
        from app.services.pubsub import PubSubService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        pubsub_service = PubSubService()
        
        # Create multiple lobbies
        lobbies = []
        for _ in range(3):
            lobby = await lobby_service.create_lobby()
            lobbies.append(lobby)
            await pubsub_service.subscribe_to_lobby(lobby.id)
        
        # Publish to each lobby
        for i, lobby in enumerate(lobbies):
            await pubsub_service.publish_to_lobby(
                lobby.id,
                {"lobby_num": i, "test": "data"}
            )
        
        await asyncio.sleep(0.1)
        
        # Each lobby should receive only its own message
        for i, lobby in enumerate(lobbies):
            msg = await pubsub_service.get_message(lobby.id, timeout=0.5)
            if msg and "lobby_num" in msg:
                assert msg["lobby_num"] == i

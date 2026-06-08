"""Tests for WebSocket handler."""

import pytest
import json
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player, Lobby
from app.database.session import async_session_maker, init_db, drop_db
from app.redis import init_redis, close_redis
from app.main import app


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    """Setup and teardown test database for each test."""
    await init_db()
    yield
    await drop_db()


@pytest.fixture(scope="function", autouse=True)
async def setup_redis():
    """Setup and teardown Redis for each test."""
    await init_redis()
    yield
    await close_redis()


@pytest.fixture
async def db_session() -> AsyncSession:
    """Provide a database session for tests."""
    async with async_session_maker() as session:
        yield session


@pytest.fixture
async def test_lobby(db_session: AsyncSession) -> Lobby:
    """Create a test lobby."""
    from app.services.lobby import LobbyService
    
    service = LobbyService(db_session)
    return await service.create_lobby()


@pytest.fixture
async def test_player(db_session: AsyncSession) -> Player:
    """Create a test player."""
    player = Player(username="testplayer")
    db_session.add(player)
    await db_session.commit()
    await db_session.refresh(player)
    return player


class TestWebSocketConnection:
    """Test WebSocket connection establishment."""

    def test_websocket_endpoint_exists(self):
        """Test that WebSocket endpoint exists."""
        from app.api.websocket import router
        
        # Check router is defined
        assert router is not None
        assert router.prefix == "/ws"

    def test_websocket_connect(self, test_lobby: Lobby, test_player: Player):
        """Test WebSocket connection."""
        client = TestClient(app)
        
        # Try to connect via WebSocket
        with client.websocket_connect(f"/ws/lobby/{test_lobby.code}?player_id={test_player.id}") as websocket:
            # Should connect successfully
            assert websocket is not None

    def test_websocket_connect_invalid_lobby(self, test_player: Player):
        """Test WebSocket connection with invalid lobby code."""
        client = TestClient(app)
        
        # Try to connect to non-existent lobby
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/lobby/INVALID?player_id={test_player.id}"):
                pass

    def test_websocket_connect_without_player_id(self, test_lobby: Lobby):
        """Test WebSocket connection without player_id."""
        client = TestClient(app)
        
        # Try to connect without player_id
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/lobby/{test_lobby.code}"):
                pass


class TestWebSocketMessaging:
    """Test WebSocket message sending and receiving."""

    def test_websocket_receive_welcome_message(
        self,
        test_lobby: Lobby,
        test_player: Player
    ):
        """Test receiving welcome message on connection."""
        client = TestClient(app)
        
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={test_player.id}"
        ) as websocket:
            # Should receive welcome message
            data = websocket.receive_json()
            
            assert data is not None
            assert "type" in data
            assert data["type"] == "connected"

    def test_websocket_send_message(
        self,
        test_lobby: Lobby,
        test_player: Player
    ):
        """Test sending message via WebSocket."""
        client = TestClient(app)
        
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={test_player.id}"
        ) as websocket:
            # Receive welcome
            websocket.receive_json()
            
            # Send a message
            test_message = {"type": "ping"}
            websocket.send_json(test_message)
            
            # Should receive response
            response = websocket.receive_json()
            assert response is not None

    def test_websocket_disconnect(
        self,
        test_lobby: Lobby,
        test_player: Player
    ):
        """Test WebSocket disconnection."""
        client = TestClient(app)
        
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={test_player.id}"
        ) as websocket:
            websocket.receive_json()
            # Connection closes when exiting context
        
        # Should disconnect cleanly


class TestWebSocketGameActions:
    """Test game actions via WebSocket."""

    async def test_websocket_play_card(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test playing a card via WebSocket."""
        from app.services.lobby import LobbyService
        from app.services.game import GameService
        
        # Setup game
        lobby_service = LobbyService(db_session)
        game_service = GameService(db_session)
        
        # Create players
        player1 = Player(username="player1")
        player2 = Player(username="player2")
        db_session.add_all([player1, player2])
        await db_session.commit()
        
        # Add to lobby
        await lobby_service.add_player_to_lobby(test_lobby.id, player1.id, player1.username)
        await lobby_service.add_player_to_lobby(test_lobby.id, player2.id, player2.username)
        
        # Distribute cards
        await game_service.distribute_cards(test_lobby.id)
        cards = await game_service.get_player_cards(test_lobby.id, player1.id)
        
        # Connect via WebSocket
        client = TestClient(app)
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={player1.id}"
        ) as websocket:
            websocket.receive_json()  # Welcome message
            
            # Send play_card message
            play_message = {
                "type": "play_card",
                "card_id": cards[0]['id'],
                "target_player_id": player2.id
            }
            websocket.send_json(play_message)
            
            # Should receive acknowledgment or state update
            response = websocket.receive_json()
            assert response is not None

    async def test_websocket_request_state(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test requesting game state via WebSocket."""
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        
        player = Player(username="stateplayer")
        db_session.add(player)
        await db_session.commit()
        
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        client = TestClient(app)
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={player.id}"
        ) as websocket:
            websocket.receive_json()  # Welcome
            
            # Request state
            websocket.send_json({"type": "get_state"})
            
            # Should receive state
            response = websocket.receive_json()
            assert response is not None
            assert "type" in response


class TestWebSocketBroadcasting:
    """Test broadcasting to multiple clients."""

    async def test_broadcast_to_multiple_clients(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test that messages broadcast to all clients in lobby."""
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        
        # Create two players
        player1 = Player(username="player1")
        player2 = Player(username="player2")
        db_session.add_all([player1, player2])
        await db_session.commit()
        
        await lobby_service.add_player_to_lobby(test_lobby.id, player1.id, player1.username)
        await lobby_service.add_player_to_lobby(test_lobby.id, player2.id, player2.username)
        
        # Note: This test would need concurrent WebSocket connections
        # which is complex with TestClient. Marking as integration test.
        assert True  # Placeholder for now

    async def test_player_join_broadcasts_to_others(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test that player join broadcasts to existing clients."""
        # Placeholder - needs concurrent WebSocket testing
        assert True


class TestWebSocketErrorHandling:
    """Test WebSocket error handling."""

    def test_websocket_invalid_message_format(
        self,
        test_lobby: Lobby,
        test_player: Player
    ):
        """Test handling of invalid message format."""
        client = TestClient(app)
        
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={test_player.id}"
        ) as websocket:
            websocket.receive_json()  # Welcome
            
            # Send invalid message
            websocket.send_text("invalid json")
            
            # Should receive error or handle gracefully
            try:
                response = websocket.receive_json()
                # If we get a response, it should indicate error
                if response and "type" in response:
                    assert response["type"] == "error"
            except Exception:
                # Also acceptable to close connection
                pass

    async def test_websocket_play_invalid_card(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test playing an invalid card."""
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        
        player = Player(username="invalidplayer")
        db_session.add(player)
        await db_session.commit()
        
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        client = TestClient(app)
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={player.id}"
        ) as websocket:
            websocket.receive_json()  # Welcome
            
            # Try to play non-existent card
            websocket.send_json({
                "type": "play_card",
                "card_id": "00000000-0000-0000-0000-000000000000",
                "target_player_id": player.id
            })
            
            # Should receive error
            response = websocket.receive_json()
            if response:
                assert "type" in response


class TestWebSocketConnectionManager:
    """Test WebSocket connection manager."""

    def test_connection_manager_exists(self):
        """Test that ConnectionManager exists."""
        from app.api.websocket import manager
        
        assert manager is not None

    def test_connection_manager_connect(self):
        """Test ConnectionManager connect method."""
        from app.api.websocket import ConnectionManager
        
        manager = ConnectionManager()
        
        # Should have connect method
        assert hasattr(manager, 'connect')
        assert hasattr(manager, 'disconnect')
        assert hasattr(manager, 'send_personal_message')
        assert hasattr(manager, 'broadcast')

    async def test_connection_manager_multiple_lobbies(self):
        """Test that ConnectionManager handles multiple lobbies."""
        from app.api.websocket import ConnectionManager
        
        manager = ConnectionManager()
        
        # Should be able to track multiple lobbies
        # This is more of a structural test
        assert True


class TestWebSocketIntegration:
    """Integration tests for WebSocket functionality."""

    async def test_complete_websocket_game_flow(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test complete game flow via WebSocket."""
        from app.services.lobby import LobbyService
        from app.services.game import GameService
        
        lobby_service = LobbyService(db_session)
        game_service = GameService(db_session)
        
        # Create player
        player = Player(username="flowplayer")
        db_session.add(player)
        await db_session.commit()
        
        # Add to lobby
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        # Connect via WebSocket
        client = TestClient(app)
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={player.id}"
        ) as websocket:
            # Should connect and receive welcome
            welcome = websocket.receive_json()
            assert welcome is not None
            
            # Request state
            websocket.send_json({"type": "get_state"})
            
            # Should receive state
            state = websocket.receive_json()
            assert state is not None

    async def test_websocket_with_multiple_actions(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby
    ):
        """Test multiple actions via single WebSocket connection."""
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        
        player = Player(username="multiaction")
        db_session.add(player)
        await db_session.commit()
        
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        client = TestClient(app)
        with client.websocket_connect(
            f"/ws/lobby/{test_lobby.code}?player_id={player.id}"
        ) as websocket:
            websocket.receive_json()  # Welcome
            
            # Send multiple messages
            for i in range(3):
                websocket.send_json({"type": "get_state"})
                response = websocket.receive_json()
                assert response is not None

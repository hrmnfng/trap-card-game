"""WebSocket endpoints for real-time game updates."""

import asyncio
import json
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import async_session_maker
from app.services.lobby import LobbyService
from app.services.game import GameService
from app.services.pubsub import PubSubService

router = APIRouter(prefix="/ws", tags=["websocket"])


class ConnectionManager:
    """Manages WebSocket connections per lobby."""

    def __init__(self):
        """Initialize connection manager."""
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.player_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, lobby_id: str, player_id: str):
        """Accept and register a new WebSocket connection.
        
        Args:
            websocket: WebSocket connection
            lobby_id: Lobby UUID
            player_id: Player UUID
        """
        await websocket.accept()
        
        # Add to lobby connections
        if lobby_id not in self.active_connections:
            self.active_connections[lobby_id] = set()
        self.active_connections[lobby_id].add(websocket)
        
        # Track player connection
        self.player_connections[player_id] = websocket

    def disconnect(self, websocket: WebSocket, lobby_id: str, player_id: str):
        """Remove a WebSocket connection.
        
        Args:
            websocket: WebSocket connection
            lobby_id: Lobby UUID
            player_id: Player UUID
        """
        # Remove from lobby connections
        if lobby_id in self.active_connections:
            self.active_connections[lobby_id].discard(websocket)
            if not self.active_connections[lobby_id]:
                del self.active_connections[lobby_id]
        
        # Remove player connection
        if player_id in self.player_connections:
            del self.player_connections[player_id]

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Send a message to a specific client.
        
        Args:
            message: Message dictionary
            websocket: Target WebSocket connection
        """
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    async def broadcast(self, message: dict, lobby_id: str):
        """Broadcast a message to all clients in a lobby.
        
        Args:
            message: Message dictionary
            lobby_id: Lobby UUID
        """
        if lobby_id in self.active_connections:
            dead_connections = set()
            for connection in self.active_connections[lobby_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    dead_connections.add(connection)
            
            # Clean up dead connections
            for connection in dead_connections:
                self.active_connections[lobby_id].discard(connection)


# Global connection manager
manager = ConnectionManager()


@router.websocket("/lobby/{lobby_code}")
async def websocket_endpoint(
    websocket: WebSocket,
    lobby_code: str,
    player_id: str = Query(...)
):
    """WebSocket endpoint for lobby connections.
    
    Args:
        websocket: WebSocket connection
        lobby_code: 6-character lobby code
        player_id: Player UUID
    """
    async with async_session_maker() as db:
        lobby_service = LobbyService(db)
        game_service = GameService(db)
        pubsub_service = PubSubService()
        
        # Validate lobby exists
        lobby = await lobby_service.get_lobby_by_code(lobby_code)
        if not lobby:
            await websocket.close(code=4004, reason="Lobby not found")
            return
        
        # Validate lobby is active
        if not await lobby_service.is_lobby_active(lobby.id):
            await websocket.close(code=4003, reason="Lobby is not active")
            return
        
        # Connect client
        await manager.connect(websocket, lobby.id, player_id)
        
        # Subscribe to lobby pub/sub
        await pubsub_service.subscribe_to_lobby(lobby.id)
        
        try:
            # Send welcome message
            await manager.send_personal_message(
                {
                    "type": "connected",
                    "lobby_id": lobby.id,
                    "lobby_code": lobby_code,
                    "player_id": player_id
                },
                websocket
            )
            
            # Send initial game state
            game_state = await game_service.get_game_state(lobby.id, player_id)
            await manager.send_personal_message(
                {
                    "type": "state_update",
                    "state": game_state
                },
                websocket
            )
            
            # Start listening for messages
            await handle_websocket_messages(
                websocket,
                lobby,
                player_id,
                db,
                manager,
                pubsub_service
            )
            
        except WebSocketDisconnect:
            manager.disconnect(websocket, lobby.id, player_id)
            await pubsub_service.unsubscribe_from_lobby(lobby.id)
            
            # Notify others
            await pubsub_service.broadcast_player_left(
                lobby.id,
                player_id,
                "Player"  # Would need to fetch username
            )
        except Exception as e:
            manager.disconnect(websocket, lobby.id, player_id)
            await pubsub_service.unsubscribe_from_lobby(lobby.id)
            print(f"WebSocket error: {e}")


async def handle_websocket_messages(
    websocket: WebSocket,
    lobby: "Lobby",
    player_id: str,
    db: AsyncSession,
    manager: ConnectionManager,
    pubsub_service: PubSubService
):
    """Handle incoming WebSocket messages.
    
    Args:
        websocket: WebSocket connection
        lobby: Lobby instance
        player_id: Player UUID
        db: Database session
        manager: Connection manager
        pubsub_service: Pub/sub service
    """
    game_service = GameService(db)
    
    # Create task for listening to pub/sub
    pubsub_task = asyncio.create_task(
        listen_to_pubsub(websocket, lobby.id, manager, pubsub_service)
    )
    
    try:
        while True:
            # Receive message from client
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError:
                await manager.send_personal_message(
                    {"type": "error", "message": "Invalid JSON"},
                    websocket
                )
                continue
            
            message_type = data.get("type")
            
            if message_type == "get_state":
                # Send current game state
                game_state = await game_service.get_game_state(lobby.id, player_id)
                await manager.send_personal_message(
                    {"type": "state_update", "state": game_state},
                    websocket
                )
            
            elif message_type == "start_game":
                # Handle game start
                print(f"[START GAME] Received start_game message from {player_id}")
                lobby_service = LobbyService(db)
                
                # Check if player is the lobby owner
                if not await lobby_service.is_lobby_owner(lobby.id, player_id):
                    await manager.send_personal_message(
                        {"type": "error", "message": "Only the lobby owner can start the game"},
                        websocket
                    )
                    continue
                
                # Check if game has already started (check lobby status, not cards)
                from app.models.database import LobbyStatus
                if lobby.status != LobbyStatus.WAITING.value:
                    await manager.send_personal_message(
                        {"type": "error", "message": "Game already started"},
                        websocket
                    )
                    continue
                
                # Get all players
                players = await lobby_service.get_lobby_players(lobby.id)
                
                # Check minimum players
                if len(players) < 2:
                    await manager.send_personal_message(
                        {"type": "error", "message": "At least 2 players required to start"},
                        websocket
                    )
                    continue
                
                # Distribute cards to all players
                success = await game_service.distribute_cards(lobby.id)
                
                if not success:
                    await manager.send_personal_message(
                        {"type": "error", "message": "Failed to start game"},
                        websocket
                    )
                    continue
                
                # Update lobby status to IN_PROGRESS
                await lobby_service.update_lobby_status(lobby.id, LobbyStatus.IN_PROGRESS)
                
                # Broadcast game started event to all players in the lobby
                await manager.broadcast(
                    {"type": "game_started", "lobby_id": lobby.id},
                    lobby.id
                )
                
                # Send each player their updated state with their cards
                for p in players:
                    p_game_state = await game_service.get_game_state(lobby.id, p.id)
                    # Send directly to the player's WebSocket if connected
                    if p.id in manager.player_connections:
                        await manager.send_personal_message(
                            {"type": "state_update", "state": p_game_state},
                            manager.player_connections[p.id]
                        )
            
            elif message_type == "play_card":
                # Handle card play
                card_id = data.get("card_id")
                target_player_id = data.get("target_player_id")
                
                if not card_id or not target_player_id:
                    await manager.send_personal_message(
                        {"type": "error", "message": "Missing card_id or target_player_id"},
                        websocket
                    )
                    continue
                
                # Validate and play card
                success = await game_service.play_card(
                    lobby.id,
                    player_id,
                    card_id,
                    target_player_id
                )
                
                if success:
                    # Get card value and player/target usernames for broadcast
                    from app.services.lobby import LobbyService
                    from sqlalchemy import select
                    from app.models.database import Player, GameAction
                    
                    lobby_service = LobbyService(db)
                    
                    # Get player username
                    result = await db.execute(
                        select(Player).where(Player.id == player_id)
                    )
                    player = result.scalar_one_or_none()
                    player_username = player.username if player else "Unknown"
                    
                    # Get target player username
                    result = await db.execute(
                        select(Player).where(Player.id == target_player_id)
                    )
                    target_player = result.scalar_one_or_none()
                    target_username = target_player.username if target_player else "Unknown"
                    
                    # Get the card value from the most recent play_card action
                    result = await db.execute(
                        select(GameAction).where(
                            GameAction.lobby_id == lobby.id,
                            GameAction.player_id == player_id,
                            GameAction.action_type == "play_card",
                            GameAction.action_metadata == card_id
                        ).order_by(GameAction.timestamp.desc())
                    )
                    card_action = result.scalar_one_or_none()
                    card_value = card_action.card_value if card_action else 0
                    
                    # Broadcast card played event to all players in lobby
                    await pubsub_service.broadcast_card_played(
                        lobby.id,
                        player_id,
                        player_username,
                        card_value,
                        target_player_id,
                        target_username
                    )
                    
                    # Send updated state to all players
                    game_state = await game_service.get_game_state(lobby.id, player_id)
                    await pubsub_service.broadcast_state_update(lobby.id, game_state)
                else:
                    await manager.send_personal_message(
                        {"type": "error", "message": "Invalid card play"},
                        websocket
                    )
            
            elif message_type == "ping":
                # Respond to ping
                await manager.send_personal_message(
                    {"type": "pong"},
                    websocket
                )
            
            else:
                await manager.send_personal_message(
                    {"type": "error", "message": f"Unknown message type: {message_type}"},
                    websocket
                )
    
    finally:
        # Cancel pub/sub listener
        pubsub_task.cancel()
        try:
            await pubsub_task
        except asyncio.CancelledError:
            pass


async def listen_to_pubsub(
    websocket: WebSocket,
    lobby_id: str,
    manager: ConnectionManager,
    pubsub_service: PubSubService
):
    """Listen to pub/sub messages and forward to WebSocket client.
    
    Args:
        websocket: WebSocket connection
        lobby_id: Lobby UUID
        manager: Connection manager
        pubsub_service: Pub/sub service
    """
    try:
        while True:
            # Try to get message from pub/sub
            message = await pubsub_service.get_message(lobby_id, timeout=1.0)
            
            if message:
                # Forward to WebSocket client
                await manager.send_personal_message(message, websocket)
            
            # Small delay to prevent tight loop
            await asyncio.sleep(0.01)
    
    except asyncio.CancelledError:
        # Task was cancelled, clean exit
        pass
    except Exception as e:
        print(f"Pub/sub listener error: {e}")

"""Redis Pub/Sub service for real-time game updates."""

import json
import asyncio
from typing import Any

from app.logger import logger
from app.redis.client import get_redis


class PubSubService:
    """Service for managing Redis pub/sub for real-time updates."""

    def __init__(self):
        """Initialize pub/sub service."""
        self._subscriptions: dict[str, Any] = {}
        self._pubsub = None

    def get_lobby_channel(self, lobby_id: str) -> str:
        """Get Redis channel name for a lobby.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            Channel name
        """
        return f"lobby:{lobby_id}"

    async def subscribe_to_lobby(self, lobby_id: str) -> bool:
        """Subscribe to a lobby's channel.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if subscribed successfully
        """
        try:
            redis_client = await get_redis()
            channel = self.get_lobby_channel(lobby_id)
            
            # Create pubsub if not exists
            if self._pubsub is None:
                self._pubsub = redis_client.pubsub()
            
            # Subscribe to channel
            await self._pubsub.subscribe(channel)
            self._subscriptions[lobby_id] = channel
            
            return True
        except Exception:
            return False

    async def unsubscribe_from_lobby(self, lobby_id: str) -> bool:
        """Unsubscribe from a lobby's channel.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if unsubscribed successfully
        """
        try:
            if self._pubsub is None:
                return True
            
            channel = self.get_lobby_channel(lobby_id)
            await self._pubsub.unsubscribe(channel)
            
            if lobby_id in self._subscriptions:
                del self._subscriptions[lobby_id]
            
            return True
        except Exception:
            return False

    async def publish_to_lobby(self, lobby_id: str, message: dict) -> int:
        """Publish a message to a lobby's channel.
        
        Args:
            lobby_id: Lobby UUID
            message: Message dictionary to publish
            
        Returns:
            Number of subscribers that received the message
        """
        try:
            redis_client = await get_redis()
            channel = self.get_lobby_channel(lobby_id)
            
            # Serialize message to JSON
            message_json = json.dumps(message)
            
            logger.debug(f"Publishing to {channel}: {message.get('type')}")
            # Publish to channel
            result = await redis_client.publish(channel, message_json)
            logger.debug(f"Published to {result} subscribers")
            return result
        except Exception as e:
            logger.error(f"Error publishing: {e}")
            return 0

    async def get_message(self, lobby_id: str, timeout: float = 1.0) -> dict | None:
        """Get a message from a lobby's channel.
        
        Args:
            lobby_id: Lobby UUID
            timeout: Timeout in seconds
            
        Returns:
            Message dictionary or None if timeout
        """
        try:
            if self._pubsub is None:
                return None
            
            # Try to get message with timeout
            message = await asyncio.wait_for(
                self._pubsub.get_message(ignore_subscribe_messages=True),
                timeout=timeout
            )
            
            if message and message['type'] == 'message':
                # Deserialize JSON message
                data = json.loads(message['data'])
                return data
            
            return None
        except asyncio.TimeoutError:
            return None
        except Exception:
            return None

    async def broadcast_player_joined(
        self,
        lobby_id: str,
        player_id: str,
        username: str
    ) -> int:
        """Broadcast player joined event.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            username: Player username
            
        Returns:
            Number of subscribers
        """
        message = {
            "type": "player_joined",
            "player_id": player_id,
            "username": username
        }
        return await self.publish_to_lobby(lobby_id, message)

    async def broadcast_player_left(
        self,
        lobby_id: str,
        player_id: str,
        username: str
    ) -> int:
        """Broadcast player left event.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            username: Player username
            
        Returns:
            Number of subscribers
        """
        message = {
            "type": "player_left",
            "player_id": player_id,
            "username": username
        }
        return await self.publish_to_lobby(lobby_id, message)

    async def broadcast_game_started(self, lobby_id: str) -> int:
        """Broadcast game started event.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            Number of subscribers
        """
        message = {
            "type": "game_started",
            "lobby_id": lobby_id
        }
        return await self.publish_to_lobby(lobby_id, message)

    async def broadcast_card_played(
        self,
        lobby_id: str,
        player_id: str,
        player_username: str,
        card_value: int,
        target_id: str,
        target_username: str
    ) -> int:
        """Broadcast card played event.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID who played
            player_username: Player username
            card_value: Value of card played
            target_id: Target player UUID
            target_username: Target player username
            
        Returns:
            Number of subscribers
        """
        message = {
            "type": "card_played",
            "player_id": player_id,
            "player_username": player_username,
            "card_value": card_value,
            "target_id": target_id,
            "target_username": target_username
        }
        return await self.publish_to_lobby(lobby_id, message)

    async def broadcast_game_ended(
        self,
        lobby_id: str,
        winner_id: str,
        winner_username: str
    ) -> int:
        """Broadcast game ended event.
        
        Args:
            lobby_id: Lobby UUID
            winner_id: Winner player UUID
            winner_username: Winner username
            
        Returns:
            Number of subscribers
        """
        message = {
            "type": "game_ended",
            "winner_id": winner_id,
            "winner_username": winner_username
        }
        return await self.publish_to_lobby(lobby_id, message)

    async def broadcast_state_update(
        self,
        lobby_id: str,
        game_state: dict
    ) -> int:
        """Broadcast full game state update.
        
        Args:
            lobby_id: Lobby UUID
            game_state: Complete game state dictionary
            
        Returns:
            Number of subscribers
        """
        message = {
            "type": "state_update",
            "state": game_state
        }
        return await self.publish_to_lobby(lobby_id, message)

    async def close(self):
        """Close pub/sub connections."""
        if self._pubsub:
            await self._pubsub.close()
            self._pubsub = None
        self._subscriptions.clear()

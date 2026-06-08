"""Firebase Cloud Messaging notification service."""

from typing import Any

from app.config import get_settings
from app.logger import logger
from app.redis import get_redis

settings = get_settings()


class NotificationService:
    """Service for managing FCM push notifications."""

    def __init__(self) -> None:
        """Initialize notification service."""
        self._firebase_app = None
        if settings.fcm_enabled and settings.firebase_credentials_path:
            try:
                import firebase_admin
                from firebase_admin import credentials

                cred = credentials.Certificate(settings.firebase_credentials_path)
                self._firebase_app = firebase_admin.initialize_app(cred)
                logger.info("Firebase Admin SDK initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
                self._firebase_app = None

    async def register_token(self, player_id: str, fcm_token: str) -> bool:
        """
        Store FCM token for a player.

        Args:
            player_id: Player identifier
            fcm_token: FCM device token

        Returns:
            True if token was stored successfully
        """
        try:
            redis = await get_redis()
            key = f"fcm_token:{player_id}"
            await redis.set(key, fcm_token, ex=86400 * 7)  # 7 days TTL
            logger.info(f"Registered FCM token for player {player_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to register FCM token: {e}")
            return False

    async def get_token(self, player_id: str) -> str | None:
        """
        Retrieve FCM token for a player.

        Args:
            player_id: Player identifier

        Returns:
            FCM token or None if not found
        """
        try:
            redis = await get_redis()
            key = f"fcm_token:{player_id}"
            token = await redis.get(key)
            return token if isinstance(token, str) else None
        except Exception as e:
            logger.error(f"Failed to get FCM token: {e}")
            return None

    async def send_notification(
        self,
        player_id: str,
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
    ) -> bool:
        """
        Send push notification to a player.

        Args:
            player_id: Target player identifier
            title: Notification title
            body: Notification body text
            data: Optional data payload

        Returns:
            True if notification was sent successfully
        """
        if not settings.fcm_enabled:
            logger.warning("FCM is disabled, skipping notification")
            return False

        if self._firebase_app is None:
            logger.warning("Firebase not initialized, skipping notification")
            return False

        try:
            from firebase_admin import messaging

            token = await self.get_token(player_id)
            if not token:
                logger.warning(f"No FCM token found for player {player_id}")
                return False

            message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                data=data or {},
                token=token,
            )

            response = messaging.send(message)
            logger.info(f"Notification sent to player {player_id}: {response}")
            return True

        except Exception as e:
            logger.error(f"Failed to send notification: {e}")
            return False

    async def send_card_played_notification(
        self,
        target_player_id: str,
        sender_username: str,
        card_value: int,
        lobby_code: str,
    ) -> bool:
        """
        Send notification when a player is tagged with a card.

        Args:
            target_player_id: Player who was tagged
            sender_username: Username of player who played the card
            card_value: Value of the card played
            lobby_code: Lobby code

        Returns:
            True if notification was sent successfully
        """
        title = "You've been tagged!"
        body = f"{sender_username} played a {card_value} on you"
        data = {
            "type": "card_played",
            "lobby_code": lobby_code,
            "sender": sender_username,
            "card_value": str(card_value),
        }

        return await self.send_notification(target_player_id, title, body, data)

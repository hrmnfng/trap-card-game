"""Lobby service for managing game lobbies."""

import random
import string
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Lobby, Player, GameAction, LobbyStatus


class LobbyService:
    """Service for managing game lobbies."""

    MAX_PLAYERS = 10
    LOBBY_CODE_LENGTH = 6
    DEFAULT_EXPIRATION_HOURS = 24

    def __init__(self, db_session: AsyncSession):
        """Initialize lobby service with database session.
        
        Args:
            db_session: SQLAlchemy async session
        """
        self.db = db_session

    async def create_lobby(self, expires_at: datetime | None = None) -> Lobby:
        """Create a new lobby with a unique code.
        
        Args:
            expires_at: Optional custom expiration time. Defaults to 24 hours from now.
            
        Returns:
            Created lobby instance
        """
        # Generate unique code
        code = await self._generate_unique_code()
        
        # Set expiration
        if expires_at is None:
            expires_at = datetime.now(timezone.utc) + timedelta(hours=self.DEFAULT_EXPIRATION_HOURS)
        
        # Create lobby
        lobby = Lobby(
            code=code,
            status=LobbyStatus.WAITING.value,
            expires_at=expires_at
        )
        
        self.db.add(lobby)
        await self.db.commit()
        await self.db.refresh(lobby)
        
        return lobby

    async def get_lobby_by_code(self, code: str) -> Lobby | None:
        """Get lobby by its code.
        
        Args:
            code: 6-character lobby code
            
        Returns:
            Lobby instance or None if not found
        """
        result = await self.db.execute(
            select(Lobby).where(Lobby.code == code)
        )
        return result.scalar_one_or_none()

    async def get_lobby_by_id(self, lobby_id: str) -> Lobby | None:
        """Get lobby by its ID.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            Lobby instance or None if not found
        """
        result = await self.db.execute(
            select(Lobby).where(Lobby.id == lobby_id)
        )
        return result.scalar_one_or_none()

    async def get_active_lobbies(self) -> list[Lobby]:
        """Get all active lobbies (in waiting or in-progress state).
        
        Returns:
            List of active lobbies
        """
        result = await self.db.execute(
            select(Lobby).where(Lobby.status.in_([LobbyStatus.WAITING.value, LobbyStatus.IN_PROGRESS.value]))
        )
        return list(result.scalars().all())

    async def _is_player_new_to_lobby(self, lobby_id: str, player_id: str) -> bool:
        """Check if a player is NEW to this lobby (never joined before).
        
        Private helper to determine if player needs card provisioning.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            
        Returns:
            True if player is new (no join action exists), False if rejoining
        """
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.player_id == player_id,
                GameAction.action_type == "join"
            )
        )
        return result.scalar_one_or_none() is None

    async def add_player_to_lobby(
        self,
        lobby_id: str,
        player_id: str,
        username: str
    ) -> bool:
        """Add a player to a lobby (idempotent join operation).
        
        This function handles the join logic only. Card dealing is handled
        separately in provision_new_player_cards() for new players only.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            username: Player's username
            
        Returns:
            True if player was added, False otherwise
        """
        # Check if lobby exists
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        # Check if lobby is full
        if await self.is_lobby_full(lobby_id):
            return False
        
        # Check if player already joined (idempotent)
        if not await self._is_player_new_to_lobby(lobby_id, player_id):
            # Player already joined, this is a rejoin - just return success
            return True
        
        # Check if username is already taken in this lobby (case-insensitive)
        # but only by a DIFFERENT player
        current_players = await self.get_lobby_players(lobby_id)
        for player in current_players:
            if player.id != player_id and player.username.lower() == username.lower():
                # Username already taken by different player
                return False
        
        # Set lobby owner if this is the first player
        if not lobby.owner_id:
            lobby.owner_id = player_id
            self.db.add(lobby)
        
        # Create join action (first time player joins)
        join_action = GameAction(
            lobby_id=lobby_id,
            player_id=player_id,
            action_type="join"
        )
        
        self.db.add(join_action)
        await self.db.commit()
        
        return True

    async def provision_new_player_cards(self, lobby_id: str, player_id: str) -> bool:
        """Deal cards to a newly provisioned player joining a lobby.
        
        This function should ONLY be called for new players joining the lobby,
        never for players who are rejoining. It deals 3 cards to the player.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            
        Returns:
            True if cards were provisioned, False otherwise
        """
        import random
        from uuid import uuid4
        from app.config import get_settings
        from app.models.database import GameAction
        
        # Verify lobby exists
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        settings = get_settings()
        
        # Deal 3 cards to the player
        for _ in range(3):
            card_value = random.randint(settings.min_card_value, settings.max_card_value)
            card_id = str(uuid4())
            
            action = GameAction(
                lobby_id=lobby_id,
                player_id=player_id,
                action_type="distribute",
                card_value=card_value,
                action_metadata=card_id
            )
            self.db.add(action)
        
        await self.db.commit()
        return True

    async def remove_player_from_lobby(
        self,
        lobby_id: str,
        player_id: str
    ) -> bool:
        """Remove a player from a lobby.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            
        Returns:
            True if player was removed, False otherwise
        """
        # Check if lobby exists
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        # Create leave action
        leave_action = GameAction(
            lobby_id=lobby_id,
            player_id=player_id,
            action_type="leave"
        )
        
        self.db.add(leave_action)
        await self.db.commit()
        
        return True

    async def get_lobby_players(self, lobby_id: str) -> list[Player]:
        """Get all players currently in a lobby.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            List of players in the lobby
        """
        # Get all join and leave actions for the lobby
        result = await self.db.execute(
            select(GameAction)
            .where(GameAction.lobby_id == lobby_id)
            .where(GameAction.action_type.in_(["join", "leave"]))
            .order_by(GameAction.timestamp)
        )
        actions = result.scalars().all()
        
        # Track current players (join adds, leave removes)
        current_players = {}
        for action in actions:
            if action.action_type == "join":
                current_players[action.player_id] = action.player_id
            elif action.action_type == "leave":
                current_players.pop(action.player_id, None)
        
        # Get player objects
        if not current_players:
            return []
        
        player_ids = list(current_players.keys())
        result = await self.db.execute(
            select(Player).where(Player.id.in_(player_ids))
        )
        return list(result.scalars().all())

    async def get_lobby_player_count(self, lobby_id: str) -> int:
        """Get the number of players currently in a lobby.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            Number of players in the lobby
        """
        players = await self.get_lobby_players(lobby_id)
        return len(players)

    async def is_lobby_full(self, lobby_id: str) -> bool:
        """Check if lobby is at maximum capacity.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if lobby is full, False otherwise
        """
        player_count = await self.get_lobby_player_count(lobby_id)
        return player_count >= self.MAX_PLAYERS

    async def close_lobby(self, lobby_id: str) -> bool:
        """Close a lobby (set status to completed).
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if lobby was closed, False if not found
        """
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        lobby.status = LobbyStatus.CONCLUDED.value
        await self.db.commit()
        
        return True

    async def update_lobby_status(self, lobby_id: str, status: LobbyStatus) -> bool:
        """Update lobby status.
        
        Args:
            lobby_id: Lobby UUID
            status: New lobby status
            
        Returns:
            True if updated, False if not found
        """
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        lobby.status = status.value
        await self.db.commit()
        
        return True

    async def is_lobby_active(self, lobby_id: str) -> bool:
        """Check if lobby is active (waiting or in-progress).
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if lobby is active, False otherwise
        """
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        return lobby.status in [LobbyStatus.WAITING.value, LobbyStatus.IN_PROGRESS.value]

    async def is_lobby_expired(self, lobby_id: str) -> bool:
        """Check if lobby has expired.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if lobby is expired, False otherwise
        """
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        return lobby.expires_at < datetime.now(timezone.utc)

    async def cleanup_expired_lobbies(self) -> int:
        """Close all expired lobbies.
        
        Returns:
            Number of lobbies closed
        """
        now = datetime.now(timezone.utc)
        
        # Find expired active lobbies
        result = await self.db.execute(
            select(Lobby).where(
                Lobby.status.in_([LobbyStatus.WAITING.value, LobbyStatus.IN_PROGRESS.value]),
                Lobby.expires_at < now
            )
        )
        expired_lobbies = result.scalars().all()
        
        # Close them
        count = 0
        for lobby in expired_lobbies:
            lobby.status = LobbyStatus.CONCLUDED.value
            count += 1
        
        if count > 0:
            await self.db.commit()
        
        return count

    async def lobby_exists(self, code: str) -> bool:
        """Check if a lobby with the given code exists.
        
        Args:
            code: Lobby code to check
            
        Returns:
            True if lobby exists, False otherwise
        """
        lobby = await self.get_lobby_by_code(code)
        return lobby is not None

    async def is_lobby_owner(self, lobby_id: str, player_id: str) -> bool:
        """Check if a player is the owner of a lobby.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            
        Returns:
            True if player is the owner, False otherwise
        """
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        return lobby.owner_id == player_id

    @staticmethod
    def is_valid_code(code: str) -> bool:
        """Validate lobby code format.
        
        Args:
            code: Code to validate
            
        Returns:
            True if code is valid format, False otherwise
        """
        if not code or len(code) != LobbyService.LOBBY_CODE_LENGTH:
            return False
        
        # Must be alphanumeric and uppercase
        return code.isalnum() and code.isupper()

    async def get_player_lobby_history(self, player_id: str) -> list[dict]:
        """Get all lobbies a player has participated in.
        
        Args:
            player_id: Player UUID
            
        Returns:
            List of lobby history items with join times
        """
        # Get all join events for this player
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.player_id == player_id,
                GameAction.action_type == "join"
            ).order_by(GameAction.timestamp.desc())
        )
        join_actions = result.scalars().all()
        
        lobby_history = []
        
        for action in join_actions:
            # Get lobby info
            lobby = await self.get_lobby_by_id(action.lobby_id)
            if not lobby:
                continue
            
            # Get owner username
            owner = None
            if lobby.owner_id:
                result = await self.db.execute(
                    select(Player).where(Player.id == lobby.owner_id)
                )
                owner = result.scalar_one_or_none()
            
            # Get player count
            player_count = await self.get_lobby_player_count(action.lobby_id)
            
            lobby_history.append({
                'id': lobby.id,
                'code': lobby.code,
                'status': lobby.status,
                'owner_id': lobby.owner_id,
                'owner_username': owner.username if owner else None,
                'created_at': lobby.created_at,
                'expires_at': lobby.expires_at,
                'player_count': player_count,
                'joined_at': action.timestamp
            })
        
        return lobby_history

    async def _generate_unique_code(self) -> str:
        """Generate a unique 6-character alphanumeric code.
        
        Returns:
            Unique lobby code
        """
        max_attempts = 100
        
        for _ in range(max_attempts):
            # Generate random code
            code = ''.join(
                random.choices(string.ascii_uppercase + string.digits, k=self.LOBBY_CODE_LENGTH)
            )
            
            # Check if unique
            if not await self.lobby_exists(code):
                return code
        
        # If we couldn't find a unique code, raise an error
        raise ValueError("Could not generate unique lobby code after maximum attempts")

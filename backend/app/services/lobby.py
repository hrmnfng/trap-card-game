"""Lobby service for managing game lobbies."""

import random
import string
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Lobby, Player, GameAction


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
            status="active",
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
        """Get all active lobbies.
        
        Returns:
            List of active lobbies
        """
        result = await self.db.execute(
            select(Lobby).where(Lobby.status == "active")
        )
        return list(result.scalars().all())

    async def add_player_to_lobby(
        self,
        lobby_id: str,
        player_id: str,
        username: str
    ) -> bool:
        """Add a player to a lobby.
        
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
        
        # Check if player already joined
        existing_join = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.player_id == player_id,
                GameAction.action_type == "join"
            )
        )
        if existing_join.scalar_one_or_none():
            # Player already joined, idempotent operation
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
        
        # Create join action
        join_action = GameAction(
            lobby_id=lobby_id,
            player_id=player_id,
            action_type="join"
        )
        
        self.db.add(join_action)
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
        
        lobby.status = "completed"
        await self.db.commit()
        
        return True

    async def is_lobby_active(self, lobby_id: str) -> bool:
        """Check if lobby is active.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if lobby is active, False otherwise
        """
        lobby = await self.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        return lobby.status == "active"

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
                Lobby.status == "active",
                Lobby.expires_at < now
            )
        )
        expired_lobbies = result.scalars().all()
        
        # Close them
        count = 0
        for lobby in expired_lobbies:
            lobby.status = "completed"
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

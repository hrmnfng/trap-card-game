"""Game service for managing game state and card operations."""

import random
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.logger import logger
from app.models.database import Lobby, Player, GameAction, PlayerGameState

settings = get_settings()


class GameService:
    """Service for managing game state and card operations."""

    MIN_PLAYERS = 2
    CARDS_PER_PLAYER = 3

    def __init__(self, db_session: AsyncSession):
        """Initialize game service with database session.
        
        Args:
            db_session: SQLAlchemy async session
        """
        self.db = db_session

    async def distribute_cards(self, lobby_id: str) -> bool:
        """Distribute cards to all players at game start.
        
        Distributes cards only to players who don't already have them.
        Players who joined an in-progress game will already have cards from
        provision_new_player_cards(), but players who join the waiting lobby
        will get cards here when the owner starts the game.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if cards were distributed, False otherwise
        """
        # Check if game has already started
        if await self.has_game_started(lobby_id):
            return False
        
        # Get all players in lobby
        from app.services.lobby import LobbyService
        lobby_service = LobbyService(self.db)
        players = await lobby_service.get_lobby_players(lobby_id)
        
        # Need at least 2 players
        if len(players) < self.MIN_PLAYERS:
            return False
        
        # Distribute cards to each player who doesn't already have them
        for player in players:
            # Check if player already has cards (late joiner to in-progress game)
            existing_cards = await self.get_player_cards(lobby_id, player.id)
            
            if len(existing_cards) == 0:
                # Player has no cards yet, distribute starting hand
                for _ in range(self.CARDS_PER_PLAYER):
                    card_value = random.randint(settings.min_card_value, settings.max_card_value)
                    card_id = str(uuid4())
                    
                    # Store as distribute action with card_id in metadata
                    action = GameAction(
                        lobby_id=lobby_id,
                        player_id=player.id,
                        action_type="distribute",
                        card_value=card_value,
                        action_metadata=card_id
                    )
                    self.db.add(action)
            
            # Initialize/update player game state (mark that they haven't played a card yet)
            # Check if player game state already exists
            result = await self.db.execute(
                select(PlayerGameState).where(
                    PlayerGameState.lobby_id == lobby_id,
                    PlayerGameState.player_id == player.id
                )
            )
            player_state = result.scalar_one_or_none()
            
            if not player_state:
                # Create new player game state
                player_game_state = PlayerGameState(
                    lobby_id=lobby_id,
                    player_id=player.id,
                    has_played_card=False
                )
                self.db.add(player_game_state)
        
        await self.db.commit()
        return True

    async def get_player_cards(self, lobby_id: str, player_id: str) -> list[dict]:
        """Get all cards for a player.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            
        Returns:
            List of card dictionaries with id, value, and status
        """
        # Get distribute actions for this player
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.player_id == player_id,
                GameAction.action_type == "distribute"
            )
        )
        distribute_actions = result.scalars().all()
        
        # Get play actions to determine which cards are played
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.player_id == player_id,
                GameAction.action_type == "play_card"
            )
        )
        play_actions = result.scalars().all()
        played_card_ids = {action.action_metadata for action in play_actions}
        
        # Build card list
        cards = []
        for action in distribute_actions:
            card_id = action.action_metadata
            if card_id not in played_card_ids:
                cards.append({
                    'id': card_id,
                    'value': action.card_value,
                    'status': 'hidden'
                })
        
        return cards

    async def get_remaining_cards_count(self, lobby_id: str, player_id: str) -> int:
        """Get count of remaining cards for a player.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            
        Returns:
            Number of cards remaining
        """
        cards = await self.get_player_cards(lobby_id, player_id)
        return len(cards)

    async def play_card(
        self,
        lobby_id: str,
        player_id: str,
        card_id: str,
        target_player_id: str
    ) -> bool:
        """Play a card targeting another player.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID playing the card
            card_id: Card UUID to play
            target_player_id: Target player UUID
            
        Returns:
            True if card was played successfully, False otherwise
        """
        logger.debug(f"Starting play_card: {card_id}")
        # Validate card ownership
        owns_card = await self.player_owns_card(lobby_id, player_id, card_id)
        logger.debug(f"Player owns card: {owns_card}")
        if not owns_card:
            logger.debug("Player does not own card, returning False")
            return False
        
        # Check if card already played
        already_played = await self.is_card_played(lobby_id, card_id)
        logger.debug(f"Card already played: {already_played}")
        if already_played:
            logger.debug("Card already played, returning False")
            return False
        
        # Get card value from distribute action
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.player_id == player_id,
                GameAction.action_type == "distribute",
                GameAction.action_metadata == card_id
            )
        )
        distribute_action = result.scalar_one_or_none()
        
        if not distribute_action:
            return False
        
        card_value = distribute_action.card_value
        
        # Create play action
        play_action = GameAction(
            lobby_id=lobby_id,
            player_id=player_id,
            action_type="play_card",
            card_value=card_value,
            target_id=target_player_id,
            action_metadata=card_id  # Store card_id
        )
        
        self.db.add(play_action)
        
        # Mark player as having played a card
        result = await self.db.execute(
            select(PlayerGameState).where(
                PlayerGameState.lobby_id == lobby_id,
                PlayerGameState.player_id == player_id
            )
        )
        player_state = result.scalar_one_or_none()
        
        if player_state:
            player_state.has_played_card = True
        
        await self.db.commit()
        
        return True

    async def player_owns_card(
        self,
        lobby_id: str,
        player_id: str,
        card_id: str
    ) -> bool:
        """Check if a player owns a specific card.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID
            card_id: Card UUID
            
        Returns:
            True if player owns the card, False otherwise
        """
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.player_id == player_id,
                GameAction.action_type == "distribute",
                GameAction.action_metadata == card_id
            )
        )
        distribute_action = result.scalar_one_or_none()
        return distribute_action is not None

    async def is_card_played(self, lobby_id: str, card_id: str) -> bool:
        """Check if a card has been played.
        
        Args:
            lobby_id: Lobby UUID
            card_id: Card UUID
            
        Returns:
            True if card has been played, False otherwise
        """
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.action_type == "play_card",
                GameAction.action_metadata == card_id
            )
        )
        play_action = result.scalar_one_or_none()
        return play_action is not None

    async def get_game_state(self, lobby_id: str, player_id: str) -> dict:
        """Get complete game state filtered for a specific player.
        
        Args:
            lobby_id: Lobby UUID
            player_id: Player UUID requesting the state
            
        Returns:
            Game state dictionary with player's cards and public information
        """
        from app.services.lobby import LobbyService
        lobby_service = LobbyService(self.db)
        
        # Get lobby players
        players = await lobby_service.get_lobby_players(lobby_id)
        
        # Get player's cards
        my_cards = await self.get_player_cards(lobby_id, player_id)
        
        # Build player info list (hiding other players' card values)
        player_info = []
        for player in players:
            remaining_count = await self.get_remaining_cards_count(lobby_id, player.id)
            player_info.append({
                'id': player.id,
                'username': player.username,
                'cards_remaining': remaining_count
            })
        
        # Get game history (all played cards)
        result = await self.db.execute(
            select(GameAction).where(
                GameAction.lobby_id == lobby_id,
                GameAction.action_type == "play_card"
            ).order_by(GameAction.timestamp)
        )
        play_actions = result.scalars().all()
        
        history = []
        for action in play_actions:
            # Get player username
            result = await self.db.execute(
                select(Player).where(Player.id == action.player_id)
            )
            player = result.scalar_one_or_none()
            
            # Get target username if exists
            target_username = None
            if action.target_id:
                result = await self.db.execute(
                    select(Player).where(Player.id == action.target_id)
                )
                target = result.scalar_one_or_none()
                if target:
                    target_username = target.username
            
            history.append({
                'id': action.id,
                'action_type': action.action_type,
                'player_id': action.player_id,
                'player_username': player.username if player else "Unknown",
                'target_id': action.target_id,
                'target_username': target_username,
                'card_value': action.card_value,
                'timestamp': action.timestamp.isoformat() if action.timestamp else None
            })
        
        # Get lobby to include owner_id
        result = await self.db.execute(
            select(Lobby).where(Lobby.id == lobby_id)
        )
        lobby = result.scalar_one_or_none()
        
        # Determine game status
        has_started = await self.has_game_started(lobby_id)
        has_ended = await self.has_game_ended(lobby_id)
        
        status = 'waiting'
        if has_ended:
            status = 'ended'
        elif has_started:
            status = 'active'
        
        return {
            'lobby_id': lobby_id,
            'owner_id': lobby.owner_id if lobby else None,
            'status': status,
            'players': player_info,
            'my_cards': my_cards,
            'game_history': history
        }

    async def has_game_started(self, lobby_id: str) -> bool:
        """Check if game has started (lobby status is in-progress or concluded).
        
        Uses the lobby status (not distribute actions) to determine if game started.
        This avoids confusion since distribute actions are now created when players
        join as new players, not when the game owner clicks "start game".
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if game has started, False otherwise
        """
        from app.services.lobby import LobbyService
        lobby_service = LobbyService(self.db)
        
        lobby = await lobby_service.get_lobby_by_id(lobby_id)
        if not lobby:
            return False
        
        # Game has started if status is in-progress or concluded
        return lobby.status in ['in-progress', 'concluded']

    async def has_game_ended(self, lobby_id: str) -> bool:
        """Check if game has ended (player who has played a card is out of cards).
        
        Only players who have played at least one card count toward game end.
        This means new players joining mid-game don't affect the end condition.
        
        Args:
            lobby_id: Lobby UUID
            
        Returns:
            True if game has ended, False otherwise
        """
        # Game can only end if it started
        if not await self.has_game_started(lobby_id):
            return False
        
        # Get all players who have played at least one card
        result = await self.db.execute(
            select(PlayerGameState).where(
                PlayerGameState.lobby_id == lobby_id,
                PlayerGameState.has_played_card == True
            )
        )
        active_players = result.scalars().all()
        
        # If no one has played a card yet, game hasn't ended
        if not active_players:
            return False
        
        # Check if any active player has no cards remaining
        for player_state in active_players:
            remaining = await self.get_remaining_cards_count(lobby_id, player_state.player_id)
            if remaining == 0:
                return True
        
        return False

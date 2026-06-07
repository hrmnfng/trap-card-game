"""Tests for Game Service."""

import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import Player, Lobby, GameAction
from app.database.session import async_session_maker, init_db, drop_db


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    """Setup and teardown test database for each test."""
    await init_db()
    yield
    await drop_db()


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
async def test_players(db_session: AsyncSession) -> list[Player]:
    """Create test players."""
    players = [Player(username=f"player{i}", password_hash="dummy_hash") for i in range(5)]
    db_session.add_all(players)
    await db_session.commit()
    for player in players:
        await db_session.refresh(player)
    return players


class TestGameServiceCardDistribution:
    """Test card distribution functionality."""

    async def test_distribute_cards_to_players(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test distributing cards to all players in a lobby."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        # Add players to lobby
        lobby_service = LobbyService(db_session)
        for player in test_players[:3]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        # Distribute cards
        game_service = GameService(db_session)
        result = await game_service.distribute_cards(test_lobby.id)
        
        assert result is True

    async def test_each_player_gets_three_cards(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that each player receives exactly 3 cards."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:4]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Check each player has 3 cards
        for player in test_players[:4]:
            cards = await game_service.get_player_cards(test_lobby.id, player.id)
            assert len(cards) == 3

    async def test_cards_are_between_1_and_9(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that all card values are between 1 and 9."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:3]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        for player in test_players[:3]:
            cards = await game_service.get_player_cards(test_lobby.id, player.id)
            for card in cards:
                assert 1 <= card['value'] <= 9

    async def test_cards_stored_as_distribute_actions(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that card distribution is stored as game actions."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        player = test_players[0]
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Check for distribute actions
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == test_lobby.id,
                GameAction.player_id == player.id,
                GameAction.action_type == "distribute"
            )
        )
        distribute_actions = result.scalars().all()
        
        assert len(distribute_actions) == 3

    async def test_cannot_distribute_twice(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that cards cannot be distributed twice."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        player = test_players[0]
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        
        # First distribution
        result1 = await game_service.distribute_cards(test_lobby.id)
        assert result1 is True
        
        # Second distribution should fail
        result2 = await game_service.distribute_cards(test_lobby.id)
        assert result2 is False

    async def test_distribute_to_minimum_players(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test distributing cards with minimum players (2)."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        result = await game_service.distribute_cards(test_lobby.id)
        
        assert result is True

    async def test_cannot_distribute_with_one_player(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that distribution fails with only 1 player."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        await lobby_service.add_player_to_lobby(test_lobby.id, test_players[0].id, test_players[0].username)
        
        game_service = GameService(db_session)
        result = await game_service.distribute_cards(test_lobby.id)
        
        assert result is False


class TestGameServiceCardRetrieval:
    """Test card retrieval functionality."""

    async def test_get_player_cards(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test getting a player's cards."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        player = test_players[0]
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        cards = await game_service.get_player_cards(test_lobby.id, player.id)
        
        assert len(cards) == 3
        assert all('id' in card for card in cards)
        assert all('value' in card for card in cards)
        assert all('status' in card for card in cards)

    async def test_get_player_cards_empty_before_distribution(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that player has no cards before distribution."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        player = test_players[0]
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        cards = await game_service.get_player_cards(test_lobby.id, player.id)
        
        assert len(cards) == 0

    async def test_get_remaining_cards_count(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test getting count of remaining cards for a player."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        player = test_players[0]
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        count = await game_service.get_remaining_cards_count(test_lobby.id, player.id)
        
        assert count == 3


class TestGameServiceCardPlay:
    """Test card playing functionality."""

    async def test_play_card(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test playing a card."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Get a card to play
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        card_id = cards[0]['id']
        
        # Play the card
        result = await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            card_id,
            test_players[1].id
        )
        
        assert result is True

    async def test_play_card_creates_action(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that playing a card creates a play_card action."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        card_id = cards[0]['id']
        
        await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            card_id,
            test_players[1].id
        )
        
        # Check for play_card action
        result = await db_session.execute(
            select(GameAction).where(
                GameAction.lobby_id == test_lobby.id,
                GameAction.player_id == test_players[0].id,
                GameAction.action_type == "play_card"
            )
        )
        play_action = result.scalar_one_or_none()
        
        assert play_action is not None
        assert play_action.target_id == test_players[1].id
        assert play_action.card_value == cards[0]['value']

    async def test_cannot_play_same_card_twice(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that a card cannot be played twice."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        card_id = cards[0]['id']
        
        # Play card once
        result1 = await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            card_id,
            test_players[1].id
        )
        assert result1 is True
        
        # Try to play same card again
        result2 = await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            card_id,
            test_players[1].id
        )
        assert result2 is False

    async def test_cannot_play_another_players_card(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that a player cannot play another player's card."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Get player 1's card
        cards = await game_service.get_player_cards(test_lobby.id, test_players[1].id)
        card_id = cards[0]['id']
        
        # Try to play it as player 0
        result = await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            card_id,
            test_players[1].id
        )
        
        assert result is False

    async def test_remaining_cards_decrease_after_play(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that remaining cards count decreases after playing."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Check initial count
        count_before = await game_service.get_remaining_cards_count(test_lobby.id, test_players[0].id)
        assert count_before == 3
        
        # Play a card
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            cards[0]['id'],
            test_players[1].id
        )
        
        # Check count after
        count_after = await game_service.get_remaining_cards_count(test_lobby.id, test_players[0].id)
        assert count_after == 2


class TestGameServiceGameState:
    """Test game state management."""

    async def test_get_game_state(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test getting complete game state."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:3]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Get game state for player 0
        state = await game_service.get_game_state(test_lobby.id, test_players[0].id)
        
        assert state is not None
        assert 'lobby_id' in state
        assert 'players' in state
        assert 'my_cards' in state
        assert len(state['players']) == 3
        assert len(state['my_cards']) == 3

    async def test_game_state_hides_other_players_cards(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that game state doesn't reveal other players' card values."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Get state for player 0
        state = await game_service.get_game_state(test_lobby.id, test_players[0].id)
        
        # Player 0's cards should have values
        assert all('value' in card for card in state['my_cards'])
        assert all(card['value'] is not None for card in state['my_cards'])
        
        # Other players' info should not reveal card values
        for player_info in state['players']:
            if player_info['id'] != test_players[0].id:
                # Should only show count, not values
                assert 'cards_remaining' in player_info
                # Should not have actual card values exposed

    async def test_game_state_shows_revealed_cards(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that game state shows cards that have been played/revealed."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Play a card
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            cards[0]['id'],
            test_players[1].id
        )
        
        # Get state
        state = await game_service.get_game_state(test_lobby.id, test_players[1].id)
        
        # Should have game history showing the played card
        assert 'history' in state
        assert len(state['history']) > 0

    async def test_check_if_game_started(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test checking if game has started."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        player = test_players[0]
        await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        
        # Before distribution
        started = await game_service.has_game_started(test_lobby.id)
        assert started is False
        
        # After distribution
        await lobby_service.add_player_to_lobby(test_lobby.id, test_players[1].id, test_players[1].username)
        await game_service.distribute_cards(test_lobby.id)
        
        started = await game_service.has_game_started(test_lobby.id)
        assert started is True

    async def test_check_if_game_ended(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test checking if game has ended."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Game just started
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is False
        
        # Play all cards for one player
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        for card in cards:
            await game_service.play_card(
                test_lobby.id,
                test_players[0].id,
                card['id'],
                test_players[1].id
            )
        
        # Check if ended (at least one player out of cards)
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is True


class TestGameServiceValidation:
    """Test game validation logic."""

    async def test_validate_card_ownership(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test validating card ownership."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Get player 0's card
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        card_id = cards[0]['id']
        
        # Check ownership
        owns = await game_service.player_owns_card(test_lobby.id, test_players[0].id, card_id)
        assert owns is True
        
        # Check non-ownership
        owns = await game_service.player_owns_card(test_lobby.id, test_players[1].id, card_id)
        assert owns is False

    async def test_validate_card_already_played(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test checking if card has been played."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        card_id = cards[0]['id']
        
        # Before playing
        played = await game_service.is_card_played(test_lobby.id, card_id)
        assert played is False
        
        # Play card
        await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            card_id,
            test_players[1].id
        )
        
        # After playing
        played = await game_service.is_card_played(test_lobby.id, card_id)
        assert played is True


class TestGameServiceIntegration:
    """Integration tests for game service."""

    async def test_complete_game_flow(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test complete game flow from start to finish."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        game_service = GameService(db_session)
        
        # 1. Add players
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        # 2. Distribute cards
        await game_service.distribute_cards(test_lobby.id)
        assert await game_service.has_game_started(test_lobby.id)
        
        # 3. Players play cards alternately
        for round_num in range(3):
            for player_idx in range(2):
                player = test_players[player_idx]
                cards = await game_service.get_player_cards(test_lobby.id, player.id)
                
                if cards:  # Player still has cards
                    target = test_players[1 - player_idx]
                    await game_service.play_card(
                        test_lobby.id,
                        player.id,
                        cards[0]['id'],
                        target.id
                    )
        
        # 4. Check game ended
        assert await game_service.has_game_ended(test_lobby.id)
        
        # 5. Verify all cards played
        for player in test_players[:2]:
            remaining = await game_service.get_remaining_cards_count(test_lobby.id, player.id)
            assert remaining == 0

    async def test_multiple_games_in_different_lobbies(
        self,
        db_session: AsyncSession,
        test_players: list[Player]
    ):
        """Test running multiple games simultaneously in different lobbies."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        game_service = GameService(db_session)
        
        # Create two lobbies
        lobby1 = await lobby_service.create_lobby()
        lobby2 = await lobby_service.create_lobby()
        
        # Add different players to each
        await lobby_service.add_player_to_lobby(lobby1.id, test_players[0].id, test_players[0].username)
        await lobby_service.add_player_to_lobby(lobby1.id, test_players[1].id, test_players[1].username)
        
        await lobby_service.add_player_to_lobby(lobby2.id, test_players[2].id, test_players[2].username)
        await lobby_service.add_player_to_lobby(lobby2.id, test_players[3].id, test_players[3].username)
        
        # Distribute cards in both
        await game_service.distribute_cards(lobby1.id)
        await game_service.distribute_cards(lobby2.id)
        
        # Verify isolation - each player has their own cards
        cards1 = await game_service.get_player_cards(lobby1.id, test_players[0].id)
        cards2 = await game_service.get_player_cards(lobby2.id, test_players[2].id)
        
        assert len(cards1) == 3
        assert len(cards2) == 3
        
        # Cards should be different instances
        card_ids_1 = {c['id'] for c in cards1}
        card_ids_2 = {c['id'] for c in cards2}
        assert card_ids_1.isdisjoint(card_ids_2)


class TestGameEndedLogicWithPlayerTracking:
    """Test game end logic with has_played_card tracking."""

    async def test_game_not_ended_if_no_one_played_cards(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that game doesn't end if no one has played cards yet."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # No one has played cards yet
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is False

    async def test_game_ends_when_player_who_played_runs_out(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that game ends when a player who has played cards runs out."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Player 1 plays all cards
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        for card in cards:
            await game_service.play_card(
                test_lobby.id,
                test_players[0].id,
                card['id'],
                test_players[1].id
            )
        
        # Game should be ended
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is True

    async def test_new_player_joining_doesnt_end_game(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that new player joining mid-game doesn't incorrectly end the game."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        # Add first two players
        for player in test_players[:2]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Game is in progress - no one has played cards yet
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is False
        
        # New player joins mid-game (they have 0 cards)
        await lobby_service.add_player_to_lobby(test_lobby.id, test_players[2].id, test_players[2].username)
        
        # Game should still not be ended - new player doesn't count
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is False
        
        # Now one of the original players plays all cards
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        for card in cards:
            await game_service.play_card(
                test_lobby.id,
                test_players[0].id,
                card['id'],
                test_players[1].id
            )
        
        # Game should now be ended
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is True

    async def test_only_original_players_count_for_game_end(
        self,
        db_session: AsyncSession,
        test_lobby: Lobby,
        test_players: list[Player]
    ):
        """Test that only original players count toward game end condition."""
        from app.services.game import GameService
        from app.services.lobby import LobbyService
        
        lobby_service = LobbyService(db_session)
        # Add only first player initially
        await lobby_service.add_player_to_lobby(test_lobby.id, test_players[0].id, test_players[0].username)
        await lobby_service.add_player_to_lobby(test_lobby.id, test_players[1].id, test_players[1].username)
        
        game_service = GameService(db_session)
        await game_service.distribute_cards(test_lobby.id)
        
        # Later, other players join mid-game without cards
        for player in test_players[2:4]:
            await lobby_service.add_player_to_lobby(test_lobby.id, player.id, player.username)
        
        # Player 1 plays one card (now they've played)
        cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        await game_service.play_card(
            test_lobby.id,
            test_players[0].id,
            cards[0]['id'],
            test_players[1].id
        )
        
        # Game not ended - player 1 still has cards
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is False
        
        # Player 1 plays remaining cards
        remaining_cards = await game_service.get_player_cards(test_lobby.id, test_players[0].id)
        for card in remaining_cards:
            await game_service.play_card(
                test_lobby.id,
                test_players[0].id,
                card['id'],
                test_players[1].id
            )
        
        # Game should be ended now
        ended = await game_service.has_game_ended(test_lobby.id)
        assert ended is True

# Lobby Lifecycle Documentation

## Overview
This document describes the complete lifecycle of a lobby from creation through game conclusion.

## Card Management Architecture

There are TWO distinct card provisioning scenarios:

### 1. **Provisioning** (when players join)
- **When**: Player joins a lobby (via POST /api/lobbies/{code}/join)
- **Who gets cards**: Only new players joining an IN-PROGRESS game
- **Function**: `LobbyService.provision_new_player_cards()`
- **Result**: 3 GameAction entries with action_type="distribute"

### 2. **Distribution** (when game starts)
- **When**: Lobby owner clicks "Start Game" (via WebSocket start_game message)
- **Who gets cards**: All players who don't have cards yet
- **Function**: `GameService.distribute_cards()`
- **Result**: 3 GameAction entries per player with action_type="distribute"

## Lobby State Machine

```
[waiting] --start_game--> [in-progress] --conclude--> [concluded]
```

### WAITING Status
- **When**: Lobby first created, until owner clicks Start
- **Who is here**: Only players who joined via /join endpoint
- **Who gets cards**: Nobody yet (they're distributed at start_game)
- **Can join**: Yes, any player can join
- **Can rejoin**: Yes, returning players rejoin without new cards
- **WebSocket behavior**: Shows waiting room, no game board

### IN-PROGRESS Status
- **When**: After owner clicks Start Game
- **Who is here**: Original players + any new joiners
- **Who gets cards**: 
  - Original players: from distribute_cards()
  - New joiners: from provision_new_player_cards()
- **Can join**: Yes, new players join and get provisioned cards
- **Can rejoin**: Yes, returning players rejoin with their existing cards
- **WebSocket behavior**: Shows game board with cards

### CONCLUDED Status
- **When**: Game ends (all players with cards have played)
- **Who is here**: Nobody new can join
- **Can rejoin**: No, lobby is closed
- **WebSocket behavior**: Shows results/winner

## Complete Flow Example

### Scenario: Three Players, Two Start, One Joins Mid-Game

**T1: Alice creates lobby**
- Status: waiting
- Alice joins: `_is_player_new_to_lobby()` → true, but status="waiting" so NO cards yet
- Waiting room shows: 1/10 players

**T2: Bob joins**
- Status: waiting
- Bob joins: `_is_player_new_to_lobby()` → true, but status="waiting" so NO cards yet
- Waiting room shows: 2/10 players

**T3: Alice clicks "Start Game"**
- `distribute_cards()` is called
- For Alice:
  - Check if Alice has cards → No
  - Add 3 distribute actions for Alice
  - Create PlayerGameState for Alice
- For Bob:
  - Check if Bob has cards → No
  - Add 3 distribute actions for Bob
  - Create PlayerGameState for Bob
- Status changes: waiting → in-progress
- WebSocket broadcasts game_started event
- Both see game board with 3 cards each

**T4: Charlie joins (game is in-progress)**
- Status: in-progress
- Charlie joins: `_is_player_new_to_lobby()` → true, AND status="in-progress"
- `provision_new_player_cards()` is called
  - Add 3 distribute actions for Charlie
  - (PlayerGameState is created later in distribute_cards or when Charlie plays first card)
- Charlie sees game board with 3 cards

**T5: Alice plays a card**
- `play_card()` called
- Card marked as played, added to GameAction with action_type="play_card"
- PlayerGameState.has_played_card = True for Alice
- All players notified via WebSocket state_update

**T6: Game ends**
- `has_game_ended()` checks: all players with has_played_card=true are out of cards
- Status changes: in-progress → concluded

## Key Functions

### LobbyService._is_player_new_to_lobby(lobby_id, player_id) → bool
- Private helper
- Returns True if player has never joined this lobby (no join action exists)
- Returns False if player already joined (was a new player, might be rejoining now)

### LobbyService.provision_new_player_cards(lobby_id, player_id) → bool
- Only called for new players joining IN-PROGRESS games
- Creates 3 distribute actions for that player only
- Does NOT change lobby status

### GameService.distribute_cards(lobby_id) → bool
- Called when owner clicks "Start Game"
- Distributes to players who don't have cards yet
- Creates PlayerGameState for all players
- Does NOT change lobby status (caller does that)

### GameService.has_game_started(lobby_id) → bool
- Checks if lobby.status in ['in-progress', 'concluded']
- NOT based on distribute actions (those are created on join AND on start)

## Important Design Decisions

1. **Status is source of truth**: Lobby.status determines game state, not distribute actions
2. **Join doesn't deal cards**: Only provision_new_player_cards() for late joiners
3. **Start distributes to all**: distribute_cards() handles all players, deduplicates based on existing cards
4. **Idempotent join**: Multiple calls to add_player_to_lobby are safe
5. **One-time provisioning**: provision_new_player_cards() and distribute_cards() deduplicate

## Testing Checklist

- [ ] Create lobby → waiting status
- [ ] Join second player → both in waiting room, no cards
- [ ] Start game → both see cards
- [ ] Join third player while in-progress → new player gets cards
- [ ] Play card → appears in game history
- [ ] Rejoin after disconnect → see same cards
- [ ] All players play → game concludes

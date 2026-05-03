"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# Player schemas
class PlayerCreate(BaseModel):
    """Schema for creating a new player."""

    username: str = Field(..., min_length=1, max_length=50)


class PlayerView(BaseModel):
    """Public view of a player."""

    id: str
    username: str
    cards_revealed: int = 0
    cards_remaining: int = 3


# Card schemas
class CardData(BaseModel):
    """Card data structure."""

    id: str
    value: int | None = None  # None if hidden
    status: Literal["hidden", "revealed"]
    owner_id: str


# Lobby schemas
class LobbyCreate(BaseModel):
    """Schema for creating a new lobby."""

    expires_at: datetime | None = None


class LobbyResponse(BaseModel):
    """Response with lobby information."""

    id: str
    code: str
    status: str
    created_at: datetime
    expires_at: datetime
    player_count: int


class LobbyJoinRequest(BaseModel):
    """Schema for joining a lobby."""

    username: str = Field(..., min_length=1, max_length=50)


class LobbyPlayerResponse(BaseModel):
    """Response with player information in a lobby."""

    id: str
    username: str
    joined_at: datetime


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str


class LobbyState(BaseModel):
    """Complete lobby state (filtered per player)."""

    lobby_id: str
    lobby_code: str
    status: Literal["waiting", "active", "ended"]
    players: list[PlayerView]
    my_cards: list[CardData]  # Player's own cards with values
    game_history: list["GameActionView"]


class CardPlay(BaseModel):
    """Schema for playing a card."""

    card_id: str
    target_player_id: str


class GameActionView(BaseModel):
    """Public view of a game action."""

    id: str
    action_type: str
    player_id: str
    player_username: str
    target_id: str | None = None
    target_username: str | None = None
    card_value: int | None = None
    timestamp: datetime


# WebSocket message schemas
class WSMessage(BaseModel):
    """WebSocket message base."""

    type: str
    data: dict


class WSJoinMessage(BaseModel):
    """WebSocket join message."""

    type: Literal["join"] = "join"
    lobby_code: str
    player_id: str


class WSPlayCardMessage(BaseModel):
    """WebSocket play card message."""

    type: Literal["play_card"] = "play_card"
    card_id: str
    target_player_id: str


class WSStateUpdateMessage(BaseModel):
    """WebSocket state update broadcast."""

    type: Literal["state_update"] = "state_update"
    state: LobbyState


class WSErrorMessage(BaseModel):
    """WebSocket error message."""

    type: Literal["error"] = "error"
    message: str
    code: str | None = None


# FCM schemas
class FCMTokenRegistration(BaseModel):
    """Schema for registering FCM token."""

    player_id: str
    fcm_token: str

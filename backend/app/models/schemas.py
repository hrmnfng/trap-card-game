"""Pydantic schemas for API request/response validation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# Auth schemas
class UserRegisterRequest(BaseModel):
    """Schema for user registration."""

    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=4, max_length=6)

    @field_validator('password')
    @classmethod
    def password_must_be_digits(cls, v: str) -> str:
        """Validate that password contains only digits."""
        if not v.isdigit():
            raise ValueError('Password must contain only digits')
        return v


class UserLoginRequest(BaseModel):
    """Schema for user login."""

    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=4, max_length=6)


class UserResponse(BaseModel):
    """Response with user information and auth token."""

    user_id: str
    username: str
    token: str


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
    owner_id: str | None = None
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


class LobbyJoinResponse(BaseModel):
    """Response after joining a lobby."""

    message: str
    player_id: str
    lobby_code: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str


class LobbyState(BaseModel):
    """Complete lobby state (filtered per player)."""

    lobby_id: str
    lobby_code: str
    status: Literal["waiting", "active", "ended"]
    owner_id: str | None = None
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


# Lobby state schemas
class LobbyStateResponse(BaseModel):
    """Response with complete lobby state for reconnection/refresh."""

    id: str
    code: str
    status: Literal["waiting", "in-progress", "concluded"]
    owner_id: str | None
    created_at: datetime
    expires_at: datetime
    player_count: int
    players: list[LobbyPlayerResponse]


class LobbyHistoryItem(BaseModel):
    """Response with lobby summary for history view."""

    id: str
    code: str
    status: Literal["waiting", "in-progress", "concluded"]
    owner_id: str | None
    owner_username: str | None
    created_at: datetime
    expires_at: datetime
    player_count: int
    joined_at: datetime  # When the user joined this lobby


# FCM schemas
class FCMTokenRegistration(BaseModel):
    """Schema for registering FCM token."""

    player_id: str
    fcm_token: str

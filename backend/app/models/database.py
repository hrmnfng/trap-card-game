"""SQLAlchemy database models."""

from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class LobbyStatus(str, Enum):
    """Enum for lobby status values."""

    WAITING = "waiting"  # Waiting for players to join
    IN_PROGRESS = "in-progress"  # Game is currently being played
    CONCLUDED = "concluded"  # Game has finished


def utcnow() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)


class Player(Base):
    """Player model for storing player information."""

    __tablename__ = "players"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    username: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=True, default="test_hash")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )

    # Relationships
    actions: Mapped[list["GameAction"]] = relationship(
        back_populates="player",
        cascade="all, delete-orphan",
    )


class Lobby(Base):
    """Lobby model for storing lobby metadata."""

    __tablename__ = "lobbies"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    code: Mapped[str] = mapped_column(String(6), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=LobbyStatus.WAITING.value, nullable=False)
    owner_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("players.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Relationships
    actions: Mapped[list["GameAction"]] = relationship(
        back_populates="lobby",
        cascade="all, delete-orphan",
    )
    owner: Mapped["Player | None"] = relationship(foreign_keys=[owner_id])


class GameAction(Base):
    """Game action model for storing all game events."""

    __tablename__ = "game_actions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    lobby_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("lobbies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    player_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action_type: Mapped[str] = mapped_column(String(20), nullable=False)
    card_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
        index=True,
    )

    # Relationships
    lobby: Mapped["Lobby"] = relationship(back_populates="actions")
    player: Mapped["Player"] = relationship(back_populates="actions")


class PlayerGameState(Base):
    """Track player-specific game state per lobby (e.g., has_played_card)."""

    __tablename__ = "player_game_states"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    lobby_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("lobbies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    player_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    has_played_card: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )

    # Relationships
    lobby: Mapped["Lobby"] = relationship()
    player: Mapped["Player"] = relationship()

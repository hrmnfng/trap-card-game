"""SQLAlchemy database models."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


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
    username: Mapped[str] = mapped_column(String(50), nullable=False)
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
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
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

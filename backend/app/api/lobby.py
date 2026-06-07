"""API endpoints for lobby management."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_authenticated_user
from app.database.session import get_db
from app.models.database import Player
from app.models.schemas import (
    LobbyCreate,
    LobbyResponse,
    LobbyJoinRequest,
    LobbyJoinResponse,
    LobbyPlayerResponse,
    LobbyStateResponse,
    LobbyHistoryItem,
    MessageResponse
)
from app.services.lobby import LobbyService

router = APIRouter(prefix="/lobbies", tags=["lobbies"])


@router.post("", response_model=LobbyResponse, status_code=status.HTTP_201_CREATED)
async def create_lobby(
    lobby_data: LobbyCreate = LobbyCreate(),
    user: Player = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db)
) -> LobbyResponse:
    """Create a new lobby (requires authentication).
    
    Args:
        lobby_data: Optional lobby configuration
        user: Authenticated user (injected by dependency)
        db: Database session
        
    Returns:
        Created lobby information including unique code
        
    Raises:
        HTTPException: 401 if not authenticated
    """
    service = LobbyService(db)
    
    # Create lobby
    lobby = await service.create_lobby(expires_at=lobby_data.expires_at)
    
    return LobbyResponse(
        id=lobby.id,
        code=lobby.code,
        status=lobby.status,
        owner_id=lobby.owner_id,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        player_count=0
    )


@router.get("/history", response_model=list[LobbyHistoryItem])
async def get_lobby_history(
    user: Player = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db)
) -> list[LobbyHistoryItem]:
    """Get all lobbies the authenticated user has participated in.
    
    Args:
        user: Authenticated user (injected by dependency)
        db: Database session
        
    Returns:
        List of lobbies user has joined, ordered by most recent first
        
    Raises:
        HTTPException: 401 if not authenticated
    """
    service = LobbyService(db)
    
    # Get player's lobby history
    history = await service.get_player_lobby_history(user.id)
    
    return [LobbyHistoryItem(**item) for item in history]


@router.get("/{code}", response_model=LobbyResponse)
async def get_lobby(
    code: str,
    db: AsyncSession = Depends(get_db)
) -> LobbyResponse:
    """Get lobby by code.
    
    Args:
        code: 6-character lobby code
        
    Returns:
        Lobby information
        
    Raises:
        HTTPException: 404 if lobby not found
    """
    # Validate code format
    if not LobbyService.is_valid_code(code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid lobby code format"
        )
    
    service = LobbyService(db)
    lobby = await service.get_lobby_by_code(code)
    
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Get player count
    player_count = await service.get_lobby_player_count(lobby.id)
    
    return LobbyResponse(
        id=lobby.id,
        code=lobby.code,
        status=lobby.status,
        owner_id=lobby.owner_id,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        player_count=player_count
    )


@router.get("", response_model=list[LobbyResponse])
async def list_active_lobbies(
    db: AsyncSession = Depends(get_db)
) -> list[LobbyResponse]:
    """List all active lobbies.
    
    Returns:
        List of active lobbies
    """
    service = LobbyService(db)
    lobbies = await service.get_active_lobbies()
    
    # Build responses with player counts
    responses = []
    for lobby in lobbies:
        player_count = await service.get_lobby_player_count(lobby.id)
        responses.append(
            LobbyResponse(
                id=lobby.id,
                code=lobby.code,
                status=lobby.status,
                owner_id=lobby.owner_id,
                created_at=lobby.created_at,
                expires_at=lobby.expires_at,
                player_count=player_count
            )
        )
    
    return responses


@router.get("/{code}/state", response_model=LobbyStateResponse)
async def get_lobby_state(
    code: str,
    db: AsyncSession = Depends(get_db)
) -> LobbyStateResponse:
    """Get complete lobby state including status and players.
    
    This endpoint is used for page refresh/reconnection to restore user to correct view.
    
    Args:
        code: 6-character lobby code
        
    Returns:
        Complete lobby state with status and player list
        
    Raises:
        HTTPException: 404 if lobby not found
    """
    # Validate code format
    if not LobbyService.is_valid_code(code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid lobby code format"
        )
    
    service = LobbyService(db)
    lobby = await service.get_lobby_by_code(code)
    
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Get player list and count
    players = await service.get_lobby_players(lobby.id)
    player_count = len(players)
    
    return LobbyStateResponse(
        id=lobby.id,
        code=lobby.code,
        status=lobby.status,
        owner_id=lobby.owner_id,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        player_count=player_count,
        players=[
            LobbyPlayerResponse(
                id=player.id,
                username=player.username,
                joined_at=player.created_at
            )
            for player in players
        ]
    )


@router.post("/{code}/join", response_model=LobbyJoinResponse)
async def join_lobby(
    code: str,
    user: Player = Depends(get_authenticated_user),
    db: AsyncSession = Depends(get_db)
) -> LobbyJoinResponse:
    """Join a lobby with authentication.
    
    Args:
        code: 6-character lobby code
        user: Authenticated user (injected by dependency)
        db: Database session
        
    Returns:
        Success message with player ID
        
    Raises:
        HTTPException: 401 if not authenticated, 404 if lobby not found, 409 if username taken
    """
    lobby_service = LobbyService(db)
    
    # Get lobby
    lobby = await lobby_service.get_lobby_by_code(code)
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Check if lobby is active (not concluded)
    if not await lobby_service.is_lobby_active(lobby.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This game has concluded and cannot accept new players"
        )
    
    # Check if lobby is full
    if await lobby_service.is_lobby_full(lobby.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lobby is full"
        )
    
    # Check if username is already taken in this lobby
    current_players = await lobby_service.get_lobby_players(lobby.id)
    for player in current_players:
        if player.username.lower() == user.username.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Username '{user.username}' is already in this lobby"
            )
    
    # Add existing player to lobby (no need to create new player)
    success = await lobby_service.add_player_to_lobby(lobby.id, user.id, user.username)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to join lobby"
        )
    
    # If game is in-progress, deal cards to the new player
    if lobby.status == "in-progress":
        from app.services.game import GameService
        game_service = GameService(db)
        
        # Deal 3 cards to the new player without affecting others
        import random
        from app.config import get_settings
        from app.models.database import GameAction
        from uuid import uuid4
        
        settings = get_settings()
        for _ in range(3):
            card_value = random.randint(settings.min_card_value, settings.max_card_value)
            card_id = str(uuid4())
            
            action = GameAction(
                lobby_id=lobby.id,
                player_id=user.id,
                action_type="distribute",
                card_value=card_value,
                action_metadata=card_id
            )
            db.add(action)
        
        await db.commit()
    
    return LobbyJoinResponse(
        message=f"Successfully joined lobby {code}",
        player_id=user.id,
        lobby_code=code
    )


@router.post("/{code}/leave", response_model=MessageResponse)
async def leave_lobby(
    code: str,
    player_id: str,
    db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    """Leave a lobby.
    
    Args:
        code: 6-character lobby code
        player_id: Player UUID
        
    Returns:
        Success message
        
    Raises:
        HTTPException: 404 if lobby not found
    """
    service = LobbyService(db)
    
    # Get lobby
    lobby = await service.get_lobby_by_code(code)
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Remove player
    success = await service.remove_player_from_lobby(lobby.id, player_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to leave lobby"
        )
    
    return MessageResponse(message=f"Successfully left lobby {code}")


@router.get("/{code}/players", response_model=list[LobbyPlayerResponse])
async def get_lobby_players(
    code: str,
    db: AsyncSession = Depends(get_db)
) -> list[LobbyPlayerResponse]:
    """Get all players in a lobby.
    
    Args:
        code: 6-character lobby code
        
    Returns:
        List of players in the lobby
        
    Raises:
        HTTPException: 404 if lobby not found
    """
    service = LobbyService(db)
    
    # Get lobby
    lobby = await service.get_lobby_by_code(code)
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Get players
    players = await service.get_lobby_players(lobby.id)
    
    return [
        LobbyPlayerResponse(
            id=player.id,
            username=player.username,
            joined_at=player.created_at
        )
        for player in players
    ]


@router.delete("/{code}", response_model=MessageResponse)
async def close_lobby(
    code: str,
    db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    """Close a lobby.
    
    Args:
        code: 6-character lobby code
        
    Returns:
        Success message
        
    Raises:
        HTTPException: 404 if lobby not found
    """
    service = LobbyService(db)
    
    # Get lobby
    lobby = await service.get_lobby_by_code(code)
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Close lobby
    success = await service.close_lobby(lobby.id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to close lobby"
        )
    
    return MessageResponse(message=f"Successfully closed lobby {code}")

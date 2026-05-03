"""API endpoints for lobby management."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.database import Player
from app.models.schemas import (
    LobbyCreate,
    LobbyResponse,
    LobbyJoinRequest,
    LobbyJoinResponse,
    LobbyPlayerResponse,
    MessageResponse
)
from app.services.lobby import LobbyService

router = APIRouter(prefix="/lobbies", tags=["lobbies"])


@router.post("", response_model=LobbyResponse, status_code=status.HTTP_201_CREATED)
async def create_lobby(
    lobby_data: LobbyCreate = LobbyCreate(),
    db: AsyncSession = Depends(get_db)
) -> LobbyResponse:
    """Create a new lobby.
    
    Returns:
        Created lobby information including unique code
    """
    service = LobbyService(db)
    
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


@router.post("/{code}/join", response_model=LobbyJoinResponse)
async def join_lobby(
    code: str,
    join_data: LobbyJoinRequest,
    db: AsyncSession = Depends(get_db)
) -> LobbyJoinResponse:
    """Join a lobby.
    
    Args:
        code: 6-character lobby code
        join_data: Player information
        
    Returns:
        Success message
        
    Raises:
        HTTPException: 404 if lobby not found, 400 if lobby is full
    """
    service = LobbyService(db)
    
    # Get lobby
    lobby = await service.get_lobby_by_code(code)
    if not lobby:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lobby not found"
        )
    
    # Check if lobby is active
    if not await service.is_lobby_active(lobby.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lobby is not active"
        )
    
    # Check if lobby is full
    if await service.is_lobby_full(lobby.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lobby is full"
        )
    
    # Check if username is already taken
    current_players = await service.get_lobby_players(lobby.id)
    for player in current_players:
        if player.username.lower() == join_data.username.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Username '{join_data.username}' is already taken in this lobby"
            )
    
    # Create or get player
    player = Player(username=join_data.username)
    db.add(player)
    await db.commit()
    await db.refresh(player)
    
    # Add player to lobby
    success = await service.add_player_to_lobby(lobby.id, player.id, join_data.username)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to join lobby"
        )
    
    return LobbyJoinResponse(
        message=f"Successfully joined lobby {code}",
        player_id=player.id,
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

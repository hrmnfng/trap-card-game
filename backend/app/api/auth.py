"""API endpoints for user authentication."""

from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.schemas import (
    UserRegisterRequest,
    UserLoginRequest,
    UserResponse,
    MessageResponse
)
from app.services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    request: UserRegisterRequest,
    db: AsyncSession = Depends(get_db)
) -> UserResponse:
    """Register a new user.
    
    Args:
        request: User registration data
        db: Database session
        
    Returns:
        User info and auth token
        
    Raises:
        HTTPException: 409 if username already exists
        HTTPException: 400 if validation fails
    """
    service = AuthService(db)
    
    try:
        player, token = await service.register_user(request.username, request.password)
        
        return UserResponse(
            user_id=player.id,
            username=player.username,
            token=token
        )
    except ValueError as e:
        if "already taken" in str(e):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e)
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/login", response_model=UserResponse)
async def login(
    request: UserLoginRequest,
    db: AsyncSession = Depends(get_db)
) -> UserResponse:
    """Login a user.
    
    Args:
        request: User login credentials
        db: Database session
        
    Returns:
        User info and auth token
        
    Raises:
        HTTPException: 401 if credentials are invalid
    """
    service = AuthService(db)
    
    try:
        player, token = await service.login_user(request.username, request.password)
        
        return UserResponse(
            user_id=player.id,
            username=player.username,
            token=token
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db)
) -> UserResponse:
    """Get current authenticated user.
    
    Args:
        authorization: Bearer token from Authorization header
        db: Database session
        
    Returns:
        Current user info and token
        
    Raises:
        HTTPException: 401 if token is invalid or missing
    """
    # Extract token from "Bearer <token>"
    try:
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise ValueError("Invalid authorization header")
        token = parts[1]
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header"
        )
    
    # Validate token
    service = AuthService(db)
    user_id = AuthService.validate_session(token)
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    # Get user
    user = await service.get_user_by_id(user_id)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    return UserResponse(
        user_id=user.id,
        username=user.username,
        token=token
    )

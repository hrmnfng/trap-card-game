"""FastAPI dependencies for authentication and authorization."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.database import Player
from app.services.auth import AuthService

logger = logging.getLogger(__name__)

# OAuth2 scheme for extracting Bearer token from Authorization header
# tokenUrl points to the login endpoint that issues tokens
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_authenticated_user(
    request: Request,
    token: Annotated[str, Depends(oauth2_scheme)],
    db: AsyncSession = Depends(get_db)
) -> Player:
    """
    Dependency that validates Bearer token and returns authenticated user.
    
    Args:
        request: FastAPI request object (for logging)
        token: Bearer token extracted from Authorization header
        db: Database session
        
    Returns:
        Authenticated Player object
        
    Raises:
        HTTPException: 401 if token is invalid or user not found
        
    Usage:
        @router.get("/protected")
        async def protected_endpoint(
            user: Player = Depends(get_authenticated_user)
        ):
            # user is already authenticated and loaded from DB
            return {"username": user.username}
    """
    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path
    
    logger.info(f"Auth request from {client_ip} to {path}")
    logger.debug(f"Token received: {token[:20]}..." if len(token) > 20 else f"Token: {token}")
    
    # Validate token exists and hasn't expired
    user_id = AuthService.validate_session(token)
    if not user_id:
        logger.warning(f"Invalid or expired token from {client_ip} for {path} - Token: {token[:20]}...")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    logger.debug(f"Token validated for user_id: {user_id}")
    
    # Get user from database
    auth_service = AuthService(db)
    user = await auth_service.get_user_by_id(user_id)
    if not user:
        logger.error(f"User {user_id} not found in database (token was valid but user missing) from {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    logger.info(f"User '{user.username}' (id={user_id[:8]}...) authenticated successfully from {client_ip}")
    return user

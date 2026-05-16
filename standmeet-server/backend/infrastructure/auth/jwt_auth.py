from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .owner_token import OwnerUser

JWT_ALGORITHM = "HS256"


class JWTOwnerInfo:
    """Lightweight stand-in for OwnerToken when authenticated via JWT."""

    def __init__(self, label: str):
        self.label = label

    def __str__(self):
        return f"JWT({self.label})"


def generate_owner_jwt(label: str = "default", expires_in_days: int = 30) -> str:
    """Generate a signed JWT for owner authentication."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "owner",
        "label": label,
        "iat": now,
        "exp": now + timedelta(days=expires_in_days),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)


def verify_owner_jwt(token: str) -> dict:
    """Verify and decode a JWT token. Raises on invalid/expired."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[JWT_ALGORITHM])


class JWTAuthentication(BaseAuthentication):
    """DRF authentication backend that validates owner JWT tokens."""

    keyword = "Bearer"

    def authenticate(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith(f"{self.keyword} "):
            return None

        token = auth_header[len(self.keyword) + 1 :]

        # Skip legacy token formats — let other backends handle them
        if token.startswith("smo_") or token.startswith("sm_"):
            return None

        try:
            claims = verify_owner_jwt(token)
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("Token expired")
        except jwt.InvalidTokenError:
            return None

        if claims.get("sub") != "owner":
            return None

        return (OwnerUser(JWTOwnerInfo(claims.get("label", "jwt"))), token)

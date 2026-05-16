from __future__ import annotations

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from domain.iam.entities import InviteCode
from infrastructure.persistence.invite_repo_impl import DjangoInviteRepository


class InviteUser:
    """Lightweight user object representing a visitor with an invite code."""

    is_authenticated = True
    is_active = True
    is_staff = False

    def __init__(self, invite: InviteCode):
        self.invite = invite

    def __str__(self):
        return f"Visitor({self.invite.label})"


class InviteCodeAuthentication(BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith(f"{self.keyword} "):
            return None

        token = auth_header[len(self.keyword) + 1 :]
        if not token.startswith("sm_"):
            return None

        repo = DjangoInviteRepository()
        invite = repo.get_by_code(token)
        if invite is None:
            raise AuthenticationFailed("Invalid invite code")
        if not invite.is_valid():
            raise AuthenticationFailed("Invite code expired or exhausted")

        return (InviteUser(invite), invite)

from __future__ import annotations

from domain.iam.entities import InviteCode
from domain.iam.exceptions import AccessDenied
from infrastructure.persistence.invite_repo_impl import DjangoInviteRepository


def authenticate_invite(token: str) -> InviteCode:
    """Validate an invite token and return the InviteCode entity.

    Used only for Mode B (web chat via /api/chat/).
    """
    if not token or not token.startswith("sm_"):
        raise AccessDenied("Invalid invite token format")

    repo = DjangoInviteRepository()
    invite = repo.get_by_code(token)
    if invite is None or not invite.is_valid():
        raise AccessDenied("Invalid or expired invite code")

    return invite

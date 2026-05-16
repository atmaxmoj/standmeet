from __future__ import annotations

from application.role_service import PUBLIC_ROLE_NAME
from domain.iam.entities import InviteCode, PathPermission
from domain.iam.exceptions import AccessDenied, InviteExpired
from domain.iam.path_matcher import PathMatcher
from domain.iam.repository import InviteRepository, RoleRepository
from domain.repo.entities import ContentEntry
from domain.repo.repository import ContentRepository


class AccessService:
    """Checks visitor permissions and filters content based on invite code."""

    def __init__(
        self,
        content_repo: ContentRepository,
        invite_repo: InviteRepository,
        role_repo: RoleRepository,
    ):
        self.content_repo = content_repo
        self.invite_repo = invite_repo
        self.role_repo = role_repo

    def _get_permissions(self, invite: InviteCode) -> list[PathPermission]:
        if invite.role_id is None:
            return []
        role = self.role_repo.get(invite.role_id)
        if role is None:
            return []
        return role.permissions

    def validate_invite(self, code: str) -> InviteCode:
        invite = self.invite_repo.get_by_code(code)
        if invite is None or not invite.is_valid():
            raise InviteExpired(code)
        return invite

    def can_access(self, invite: InviteCode, path: str) -> bool:
        permissions = self._get_permissions(invite)
        matcher = PathMatcher(permissions)
        return matcher.is_allowed(path)

    def can_public_access(self, path: str) -> bool:
        role = self.role_repo.get_by_name(PUBLIC_ROLE_NAME)
        if role is None:
            return False
        matcher = PathMatcher(role.permissions)
        return matcher.is_allowed(path)

    def get_accessible_content(self, invite: InviteCode, path: str) -> ContentEntry:
        if not self.can_access(invite, path):
            raise AccessDenied(path)
        entry = self.content_repo.get_by_path(path)
        if entry is None:
            from domain.repo.exceptions import ContentNotFound

            raise ContentNotFound(path)
        return entry

    def list_accessible_content(
        self, invite: InviteCode, prefix: str = ""
    ) -> list[ContentEntry]:
        entries = self.content_repo.list_by_prefix(prefix)
        permissions = self._get_permissions(invite)
        matcher = PathMatcher(permissions)
        return [e for e in entries if matcher.is_allowed(e.path)]

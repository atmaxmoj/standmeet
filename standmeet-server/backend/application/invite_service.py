from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from domain.iam.entities import InviteCode
from domain.iam.exceptions import InviteExpired
from domain.iam.repository import InviteRepository


class InviteService:
    def __init__(self, repo: InviteRepository):
        self.repo = repo

    def create(
        self,
        label: str,
        role_id: UUID | None = None,
        max_uses: int | None = None,
        max_messages_per_session: int | None = None,
        expires_in_hours: int | None = None,
        prompt: str = "",
        greeting: str = "",
        page_id: UUID | None = None,
        mcp_server_ids: list[UUID] | None = None,
        skill_ids: list[UUID] | None = None,
    ) -> InviteCode:
        code = f"sm_{secrets.token_urlsafe(24)}"

        expires_at = None
        if expires_in_hours is not None:
            expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)

        invite = InviteCode(
            code=code,
            label=label,
            role_id=role_id,
            max_uses=max_uses,
            max_messages_per_session=max_messages_per_session,
            expires_at=expires_at,
            prompt=prompt,
            greeting=greeting,
            page_id=page_id,
            mcp_server_ids=mcp_server_ids or [],
            skill_ids=skill_ids or [],
        )
        return self.repo.save(invite)

    def list_all(self) -> list[InviteCode]:
        return self.repo.list_all()

    def get(self, code: str) -> InviteCode:
        invite = self.repo.get_by_code(code)
        if invite is None:
            raise InviteExpired(code)
        return invite

    def revoke(self, code: str) -> bool:
        invite = self.repo.get_by_code(code)
        if invite is None:
            return False
        invite.is_active = False
        self.repo.save(invite)
        return True

    def record_use(self, code: str) -> None:
        self.repo.increment_use_count(code)

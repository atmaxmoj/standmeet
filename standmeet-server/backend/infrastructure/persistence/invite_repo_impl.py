from __future__ import annotations

from django.db import models, transaction

from domain.iam.entities import InviteCode
from domain.iam.repository import InviteRepository
from infrastructure.persistence.models import InviteCodeModel, PageModel, RoleModel


class DjangoInviteRepository(InviteRepository):
    def _to_entity(self, model: InviteCodeModel) -> InviteCode:
        mcp_server_ids = list(model.mcp_servers.values_list("id", flat=True))
        skill_ids = list(model.skills.values_list("id", flat=True))
        return InviteCode(
            id=model.id,
            code=model.code,
            label=model.label,
            is_active=model.is_active,
            max_uses=model.max_uses,
            use_count=model.use_count,
            expires_at=model.expires_at,
            max_messages_per_session=model.max_messages_per_session,
            role_id=model.role_id,
            prompt=model.prompt,
            greeting=model.greeting,
            page_id=model.page_id,
            mcp_server_ids=mcp_server_ids,
            skill_ids=skill_ids,
            created_at=model.created_at,
        )

    def get_by_code(self, code: str) -> InviteCode | None:
        try:
            model = InviteCodeModel.objects.get(code=code)
            return self._to_entity(model)
        except InviteCodeModel.DoesNotExist:
            return None

    def list_all(self) -> list[InviteCode]:
        qs = InviteCodeModel.objects.all()
        return [self._to_entity(m) for m in qs]

    @transaction.atomic
    def save(self, invite: InviteCode) -> InviteCode:
        role_model = None
        if invite.role_id is not None:
            try:
                role_model = RoleModel.objects.get(id=invite.role_id)
            except RoleModel.DoesNotExist:
                pass

        page_model = None
        if invite.page_id is not None:
            try:
                page_model = PageModel.objects.get(id=invite.page_id)
            except PageModel.DoesNotExist:
                pass

        model, _ = InviteCodeModel.objects.update_or_create(
            code=invite.code,
            defaults={
                "id": invite.id,
                "label": invite.label,
                "is_active": invite.is_active,
                "max_uses": invite.max_uses,
                "use_count": invite.use_count,
                "expires_at": invite.expires_at,
                "max_messages_per_session": invite.max_messages_per_session,
                "role": role_model,
                "prompt": invite.prompt,
                "greeting": invite.greeting,
                "page": page_model,
            },
        )
        model.mcp_servers.set(invite.mcp_server_ids)
        model.skills.set(invite.skill_ids)
        return self._to_entity(
            InviteCodeModel.objects.get(code=invite.code)
        )

    def delete(self, code: str) -> bool:
        count, _ = InviteCodeModel.objects.filter(code=code).delete()
        return count > 0

    def increment_use_count(self, code: str) -> None:
        InviteCodeModel.objects.filter(code=code).update(
            use_count=models.F("use_count") + 1,
        )

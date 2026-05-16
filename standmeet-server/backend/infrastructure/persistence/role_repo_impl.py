from __future__ import annotations

from uuid import UUID

from django.db import transaction

from domain.iam.entities import PathPermission, Role
from domain.iam.repository import RoleRepository
from infrastructure.persistence.models import PathPermissionModel, RoleModel


class DjangoRoleRepository(RoleRepository):
    def _to_entity(self, model: RoleModel) -> Role:
        permissions = [
            PathPermission(
                action=p.action,
                path_pattern=p.path_pattern,
                order=p.order,
            )
            for p in model.permissions.all()
        ]
        return Role(
            id=model.id,
            name=model.name,
            permissions=permissions,
            prompt=model.prompt,
            created_at=model.created_at,
        )

    def get(self, id: UUID) -> Role | None:
        try:
            model = RoleModel.objects.prefetch_related("permissions").get(id=id)
            return self._to_entity(model)
        except RoleModel.DoesNotExist:
            return None

    def get_by_name(self, name: str) -> Role | None:
        try:
            model = RoleModel.objects.prefetch_related("permissions").get(name=name)
            return self._to_entity(model)
        except RoleModel.DoesNotExist:
            return None

    def list_all(self) -> list[Role]:
        qs = RoleModel.objects.prefetch_related("permissions").all()
        return [self._to_entity(m) for m in qs]

    @transaction.atomic
    def save(self, role: Role) -> Role:
        model, _ = RoleModel.objects.update_or_create(
            id=role.id,
            defaults={"name": role.name, "prompt": role.prompt},
        )
        # Replace permissions
        model.permissions.all().delete()
        for perm in role.permissions:
            PathPermissionModel.objects.create(
                role=model,
                action=perm.action,
                path_pattern=perm.path_pattern,
                order=perm.order,
            )
        return self._to_entity(
            RoleModel.objects.prefetch_related("permissions").get(id=role.id)
        )

    def delete(self, id: UUID) -> bool:
        count, _ = RoleModel.objects.filter(id=id).delete()
        return count > 0

    def is_referenced(self, id: UUID) -> bool:
        try:
            model = RoleModel.objects.get(id=id)
            return model.invites.exists()
        except RoleModel.DoesNotExist:
            return False

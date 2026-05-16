from __future__ import annotations

from uuid import UUID

from domain.iam.entities import PathPermission, Role
from domain.iam.repository import RoleRepository

PUBLIC_ROLE_NAME = "public"


class RoleInUseError(Exception):
    def __init__(self, role_id: UUID):
        self.role_id = role_id
        super().__init__(f"Role {role_id} is still referenced by invites")


class RoleService:
    def __init__(self, repo: RoleRepository):
        self.repo = repo

    def create(self, name: str, permissions: list[dict] | None = None, prompt: str = "") -> Role:
        perms = []
        if permissions:
            for i, p in enumerate(permissions):
                perms.append(
                    PathPermission(
                        action=p.get("action", "allow"),
                        path_pattern=p["path_pattern"],
                        order=p.get("order", i),
                    )
                )
        role = Role(name=name, permissions=perms, prompt=prompt)
        return self.repo.save(role)

    def list_all(self) -> list[Role]:
        return self.repo.list_all()

    def get(self, id: UUID) -> Role | None:
        return self.repo.get(id)

    def update(
        self,
        id: UUID,
        name: str | None = None,
        permissions: list[dict] | None = None,
        prompt: str | None = None,
    ) -> Role | None:
        role = self.repo.get(id)
        if role is None:
            return None
        if name is not None:
            role.name = name
        if prompt is not None:
            role.prompt = prompt
        if permissions is not None:
            perms = []
            for i, p in enumerate(permissions):
                perms.append(
                    PathPermission(
                        action=p.get("action", "allow"),
                        path_pattern=p["path_pattern"],
                        order=p.get("order", i),
                    )
                )
            role.permissions = perms
        return self.repo.save(role)

    def delete(self, id: UUID) -> bool:
        if self.repo.is_referenced(id):
            raise RoleInUseError(id)
        return self.repo.delete(id)

    def get_or_create_public(self) -> Role:
        role = self.repo.get_by_name(PUBLIC_ROLE_NAME)
        if role is not None:
            return role
        return self.repo.save(Role(name=PUBLIC_ROLE_NAME))

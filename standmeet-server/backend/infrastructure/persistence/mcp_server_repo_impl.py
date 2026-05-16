from __future__ import annotations

from uuid import UUID

from domain.iam.entities import McpServer
from domain.iam.repository import McpServerRepository
from infrastructure.persistence.models import McpServerModel


class DjangoMcpServerRepository(McpServerRepository):
    def _to_entity(self, model: McpServerModel) -> McpServer:
        return McpServer(
            id=model.id,
            name=model.name,
            config=model.config,
            created_at=model.created_at,
        )

    def get(self, id: UUID) -> McpServer | None:
        try:
            model = McpServerModel.objects.get(id=id)
            return self._to_entity(model)
        except McpServerModel.DoesNotExist:
            return None

    def get_by_name(self, name: str) -> McpServer | None:
        try:
            model = McpServerModel.objects.get(name=name)
            return self._to_entity(model)
        except McpServerModel.DoesNotExist:
            return None

    def list_all(self) -> list[McpServer]:
        qs = McpServerModel.objects.all()
        return [self._to_entity(m) for m in qs]

    def save(self, server: McpServer) -> McpServer:
        model, _ = McpServerModel.objects.update_or_create(
            id=server.id,
            defaults={"name": server.name, "config": server.config},
        )
        return self._to_entity(
            McpServerModel.objects.get(id=server.id)
        )

    def delete(self, id: UUID) -> bool:
        count, _ = McpServerModel.objects.filter(id=id).delete()
        return count > 0

    def is_referenced(self, id: UUID) -> bool:
        try:
            model = McpServerModel.objects.get(id=id)
            return model.invites.exists()
        except McpServerModel.DoesNotExist:
            return False

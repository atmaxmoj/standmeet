from __future__ import annotations

from uuid import UUID

from domain.iam.entities import McpServer
from domain.iam.exceptions import McpServerInUseError
from domain.iam.repository import McpServerRepository


class McpServerService:
    def __init__(self, repo: McpServerRepository):
        self.repo = repo

    def create(self, name: str, config: dict | None = None) -> McpServer:
        server = McpServer(name=name, config=config or {})
        return self.repo.save(server)

    def list_all(self) -> list[McpServer]:
        return self.repo.list_all()

    def get(self, id: UUID) -> McpServer | None:
        return self.repo.get(id)

    def update(
        self,
        id: UUID,
        name: str | None = None,
        config: dict | None = None,
    ) -> McpServer | None:
        server = self.repo.get(id)
        if server is None:
            return None
        if name is not None:
            server.name = name
        if config is not None:
            server.config = config
        return self.repo.save(server)

    def delete(self, id: UUID) -> bool:
        if self.repo.is_referenced(id):
            raise McpServerInUseError(id)
        return self.repo.delete(id)

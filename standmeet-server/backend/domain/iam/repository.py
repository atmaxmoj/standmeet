from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from domain.iam.entities import InviteCode, McpServer, Role, Skill


class InviteRepository(ABC):
    @abstractmethod
    def get_by_code(self, code: str) -> InviteCode | None: ...

    @abstractmethod
    def list_all(self) -> list[InviteCode]: ...

    @abstractmethod
    def save(self, invite: InviteCode) -> InviteCode: ...

    @abstractmethod
    def delete(self, code: str) -> bool: ...

    @abstractmethod
    def increment_use_count(self, code: str) -> None: ...


class McpServerRepository(ABC):
    @abstractmethod
    def get(self, id: UUID) -> McpServer | None: ...

    @abstractmethod
    def get_by_name(self, name: str) -> McpServer | None: ...

    @abstractmethod
    def list_all(self) -> list[McpServer]: ...

    @abstractmethod
    def save(self, server: McpServer) -> McpServer: ...

    @abstractmethod
    def delete(self, id: UUID) -> bool: ...

    @abstractmethod
    def is_referenced(self, id: UUID) -> bool: ...


class SkillRepository(ABC):
    @abstractmethod
    def get(self, id: UUID) -> Skill | None: ...

    @abstractmethod
    def get_by_name(self, name: str) -> Skill | None: ...

    @abstractmethod
    def list_all(self) -> list[Skill]: ...

    @abstractmethod
    def save(self, skill: Skill) -> Skill: ...

    @abstractmethod
    def delete(self, id: UUID) -> bool: ...

    @abstractmethod
    def is_referenced(self, id: UUID) -> bool: ...


class RoleRepository(ABC):
    @abstractmethod
    def get(self, id: UUID) -> Role | None: ...

    @abstractmethod
    def get_by_name(self, name: str) -> Role | None: ...

    @abstractmethod
    def list_all(self) -> list[Role]: ...

    @abstractmethod
    def save(self, role: Role) -> Role: ...

    @abstractmethod
    def delete(self, id: UUID) -> bool: ...

    @abstractmethod
    def is_referenced(self, id: UUID) -> bool: ...

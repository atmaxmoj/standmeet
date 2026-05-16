from __future__ import annotations

from abc import ABC, abstractmethod

from domain.repo.entities import ContentEntry


class ContentRepository(ABC):
    @abstractmethod
    def get_by_path(self, path: str) -> ContentEntry | None: ...

    @abstractmethod
    def list_by_prefix(self, prefix: str) -> list[ContentEntry]: ...

    @abstractmethod
    def get_public_by_path(self, path: str) -> ContentEntry | None: ...

    @abstractmethod
    def list_public(self, prefix: str) -> list[ContentEntry]: ...

    @abstractmethod
    def save(self, entry: ContentEntry) -> ContentEntry: ...

    @abstractmethod
    def delete(self, path: str) -> bool: ...

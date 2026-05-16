from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from domain.page.entities import Page


class PageRepository(ABC):
    @abstractmethod
    def get_by_id(self, page_id: UUID) -> Page | None: ...

    @abstractmethod
    def list_all(self) -> list[Page]: ...

    @abstractmethod
    def save(self, page: Page) -> Page: ...

    @abstractmethod
    def delete(self, page_id: UUID) -> bool: ...

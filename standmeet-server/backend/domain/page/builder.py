from __future__ import annotations

from abc import ABC, abstractmethod

from domain.page.entities import BuildContext, BuildResult


class PageBuilder(ABC):
    @abstractmethod
    async def build(self, context: BuildContext) -> BuildResult: ...

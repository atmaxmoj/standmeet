from __future__ import annotations

from abc import ABC, abstractmethod

from domain.asset.entities import Asset


class AssetRepository(ABC):
    @abstractmethod
    def get_by_path(self, path: str) -> Asset | None: ...

    @abstractmethod
    def list_by_prefix(self, prefix: str) -> list[Asset]: ...

    @abstractmethod
    def list_public(self, prefix: str = "") -> list[Asset]: ...

    @abstractmethod
    def save(self, asset: Asset) -> Asset: ...

    @abstractmethod
    def delete(self, path: str) -> bool: ...

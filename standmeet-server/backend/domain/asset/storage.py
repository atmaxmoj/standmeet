from __future__ import annotations

from abc import ABC, abstractmethod


class AssetStorage(ABC):
    @abstractmethod
    def upload(self, path: str, data: bytes, mime_type: str) -> None: ...

    @abstractmethod
    def delete(self, path: str) -> None: ...

    @abstractmethod
    def presigned_url(self, path: str, expires_in: int = 3600) -> str: ...

    @abstractmethod
    def exists(self, path: str) -> bool: ...

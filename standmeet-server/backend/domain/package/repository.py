from __future__ import annotations

from abc import ABC, abstractmethod

from domain.package.entities import GlobalPackage


class PackageRepository(ABC):
    @abstractmethod
    def list_installed(self) -> list[GlobalPackage]: ...

    @abstractmethod
    def install(self, name: str) -> GlobalPackage: ...

    @abstractmethod
    def uninstall(self, name: str) -> None: ...

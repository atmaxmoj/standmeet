from __future__ import annotations

import re

from domain.package.entities import GlobalPackage
from domain.package.repository import PackageRepository

PACKAGE_NAME_RE = re.compile(r"^[a-zA-Z0-9@/_-][a-zA-Z0-9@/_.\-]*$")


class InvalidPackageName(Exception):
    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Invalid package name: {name}")


class PackageService:
    def __init__(self, repo: PackageRepository):
        self.repo = repo

    def list_packages(self) -> list[GlobalPackage]:
        return self.repo.list_installed()

    def install_package(self, name: str) -> GlobalPackage:
        if not PACKAGE_NAME_RE.match(name):
            raise InvalidPackageName(name)
        return self.repo.install(name)

    def uninstall_package(self, name: str) -> None:
        self.repo.uninstall(name)

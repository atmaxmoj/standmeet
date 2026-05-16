from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from domain.package.entities import GlobalPackage
from domain.package.repository import PackageRepository

logger = logging.getLogger(__name__)

GLOBAL_PACKAGES_DIR = "/data/global-packages"

# Flags inspired by n8n's community-packages service to avoid
# ENOTEMPTY and symlink issues on Docker named volumes.
NPM_COMMON_FLAGS = [
    "--audit=false",
    "--fund=false",
]

NPM_INSTALL_FLAGS = [
    "--install-strategy=shallow",  # avoids deep nesting that triggers ENOTEMPTY
    "--bin-links=false",           # avoids symlink issues on Docker volumes
    "--package-lock=false",        # no lock file needed for a shared package pool
]


class NpmPackageManager(PackageRepository):
    def __init__(self, base_dir: str = GLOBAL_PACKAGES_DIR):
        self.base_dir = Path(base_dir)

    def _ensure_init(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        pkg_json = self.base_dir / "package.json"
        if not pkg_json.exists():
            pkg_json.write_text(json.dumps({"name": "global-packages", "private": True, "dependencies": {}}, indent=2))

    def _run_npm(self, args: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["npm", *args, *NPM_COMMON_FLAGS],
            cwd=str(self.base_dir),
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def list_installed(self) -> list[GlobalPackage]:
        self._ensure_init()
        pkg_json = self.base_dir / "package.json"
        data = json.loads(pkg_json.read_text())
        deps = data.get("dependencies", {})
        return [GlobalPackage(name=name, version=version) for name, version in sorted(deps.items())]

    def install(self, name: str) -> GlobalPackage:
        self._ensure_init()
        logger.info("Installing global package: %s", name)
        result = self._run_npm(["install", "--save", *NPM_INSTALL_FLAGS, name])
        if result.returncode != 0:
            raise RuntimeError(f"npm install failed: {result.stderr}")

        # Read back the installed version
        pkg_json = self.base_dir / "package.json"
        data = json.loads(pkg_json.read_text())
        deps = data.get("dependencies", {})

        # Handle scoped packages — the name in deps might differ
        version = deps.get(name, "unknown")
        return GlobalPackage(name=name, version=version)

    def uninstall(self, name: str) -> None:
        self._ensure_init()
        logger.info("Uninstalling global package: %s", name)
        result = self._run_npm(["uninstall", "--save", name], timeout=60)
        if result.returncode != 0:
            raise RuntimeError(f"npm uninstall failed: {result.stderr}")

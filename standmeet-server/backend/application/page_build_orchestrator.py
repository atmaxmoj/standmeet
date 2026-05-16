from __future__ import annotations

import logging

from domain.asset.repository import AssetRepository
from domain.asset.storage import AssetStorage
from domain.package.repository import PackageRepository
from domain.page.builder import PageBuilder
from domain.page.entities import BuildContext, BuildResult, Page
from domain.page.repository import PageRepository
from domain.repo.repository import ContentRepository

logger = logging.getLogger(__name__)


class PageBuildOrchestrator:
    """Orchestrates the full page build lifecycle:
    1. Prepare build context (content data, asset manifest)
    2. Call the builder
    3. Upload outputs to S3
    4. Update page status
    """

    def __init__(
        self,
        builder: PageBuilder,
        page_repo: PageRepository,
        content_repo: ContentRepository,
        asset_repo: AssetRepository,
        asset_storage: AssetStorage,
        package_repo: PackageRepository | None = None,
    ):
        self.builder = builder
        self.page_repo = page_repo
        self.content_repo = content_repo
        self.asset_repo = asset_repo
        self.asset_storage = asset_storage
        self.package_repo = package_repo

    async def build_page(self, page: Page) -> BuildResult:
        logger.info("Starting build for page %s (%s)", page.name, page.id)

        # 1. Prepare context
        context = self._prepare_context(page)

        # 2. Run build
        result = await self.builder.build(context)

        # 3. Upload outputs to S3
        if result.status == "success":
            for filepath, data in result.output_files.items():
                s3_key = f"/pages/{page.id}/{filepath}"
                mime = self._guess_mime(filepath)
                self.asset_storage.upload(s3_key, data, mime)
            logger.info("Uploaded %d files for page %s", len(result.output_files), page.id)

        # 4. Update page status
        page.status = "ready" if result.status == "success" else "failed"
        page.build_log = result.build_log
        self.page_repo.save(page)

        logger.info("Build %s for page %s (took %dms)", result.status, page.id, result.duration_ms)
        return result

    def _prepare_context(self, page: Page) -> BuildContext:
        # Get content data based on role permissions
        content_data = []
        if page.role_id:
            from domain.iam.path_matcher import PathMatcher
            from infrastructure.persistence.role_repo_impl import DjangoRoleRepository

            role_repo = DjangoRoleRepository()
            role = role_repo.get(page.role_id)
            entries = self.content_repo.list_by_prefix("")
            if role and role.permissions:
                matcher = PathMatcher(role.permissions)
                entries = [e for e in entries if matcher.is_allowed(e.path)]
            content_data = [
                {
                    "path": e.path,
                    "content": e.content,
                    "summary": e.summary,
                }
                for e in entries
            ]
        else:
            # No role — include all content
            entries = self.content_repo.list_by_prefix("")
            content_data = [
                {
                    "path": e.path,
                    "content": e.content,
                    "summary": e.summary,
                }
                for e in entries
            ]

        # Get asset manifest (public assets only for pages)
        assets = self.asset_repo.list_public()
        asset_manifest = {}
        for asset in assets:
            try:
                url = self.asset_storage.presigned_url(asset.path, expires_in=86400)
                asset_manifest[asset.path] = url
            except Exception:
                logger.warning("Failed to get URL for asset %s", asset.path)

        # Compute final package list: (global - dont_use) + must_use
        packages = self._compute_packages(page)

        return BuildContext(
            source_files=page.source_files,
            packages=packages,
            content_data=content_data,
            asset_manifest=asset_manifest,
            page_id=str(page.id),
            meta=page.meta,
        )

    def _compute_packages(self, page: Page) -> list[str]:
        """Compute final package list: (global packages - dont_use) + must_use."""
        if self.package_repo:
            global_pkgs = {p.name for p in self.package_repo.list_installed()}
        else:
            global_pkgs = set()

        dont_use_set = set(page.dont_use)
        result = {name for name in global_pkgs if name not in dont_use_set}
        result.update(page.must_use)
        return sorted(result)

    @staticmethod
    def _guess_mime(filepath: str) -> str:
        ext = filepath.rsplit(".", 1)[-1].lower() if "." in filepath else ""
        return {
            "html": "text/html",
            "js": "application/javascript",
            "css": "text/css",
            "json": "application/json",
            "svg": "image/svg+xml",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "ico": "image/x-icon",
            "woff": "font/woff",
            "woff2": "font/woff2",
        }.get(ext, "application/octet-stream")

from __future__ import annotations

import re
from uuid import UUID

from domain.page.entities import Page, PageMeta
from domain.page.exceptions import InvalidPackageName, PageBuildInProgress, PageNotFound
from domain.page.repository import PageRepository

PACKAGE_NAME_RE = re.compile(r"^[a-zA-Z0-9@/_-][a-zA-Z0-9@/_.\-]*$")


class PageService:
    def __init__(self, repo: PageRepository):
        self.repo = repo

    def get(self, page_id: UUID) -> Page:
        page = self.repo.get_by_id(page_id)
        if page is None:
            raise PageNotFound(page_id)
        return page

    def list_all(self) -> list[Page]:
        return self.repo.list_all()

    def create(
        self,
        name: str,
        description: str = "",
        source_files: dict | None = None,
        must_use: list[str] | None = None,
        dont_use: list[str] | None = None,
        package_constraints: str = "",
        meta: dict | None = None,
        role_id: UUID | None = None,
    ) -> Page:
        must_use = must_use or []
        dont_use = dont_use or []
        self._validate_packages(must_use)
        self._validate_packages(dont_use)

        page_meta = PageMeta()
        if meta:
            page_meta = PageMeta(
                title=meta.get("title", ""),
                description=meta.get("description", ""),
                favicon_asset_path=meta.get("favicon_asset_path"),
                og_image_asset_path=meta.get("og_image_asset_path"),
                custom_head=meta.get("custom_head", ""),
            )

        page = Page(
            name=name,
            description=description,
            source_files=source_files or {},
            must_use=must_use,
            dont_use=dont_use,
            package_constraints=package_constraints,
            meta=page_meta,
            role_id=role_id,
        )
        return self.repo.save(page)

    def update(self, page_id: UUID, **kwargs) -> Page:
        page = self.get(page_id)

        if "name" in kwargs:
            page.name = kwargs["name"]
        if "description" in kwargs:
            page.description = kwargs["description"]
        if "source_files" in kwargs:
            page.source_files = kwargs["source_files"]
        if "must_use" in kwargs:
            self._validate_packages(kwargs["must_use"])
            page.must_use = kwargs["must_use"]
        if "dont_use" in kwargs:
            self._validate_packages(kwargs["dont_use"])
            page.dont_use = kwargs["dont_use"]
        if "package_constraints" in kwargs:
            page.package_constraints = kwargs["package_constraints"]
        if "meta" in kwargs:
            meta = kwargs["meta"]
            page.meta = PageMeta(
                title=meta.get("title", ""),
                description=meta.get("description", ""),
                favicon_asset_path=meta.get("favicon_asset_path"),
                og_image_asset_path=meta.get("og_image_asset_path"),
                custom_head=meta.get("custom_head", ""),
            )
        if "role_id" in kwargs:
            page.role_id = kwargs["role_id"]

        return self.repo.save(page)

    def delete(self, page_id: UUID) -> bool:
        page = self.repo.get_by_id(page_id)
        if page is None:
            raise PageNotFound(page_id)
        return self.repo.delete(page_id)

    def set_status(self, page_id: UUID, status: str, build_log: str = "") -> Page:
        page = self.get(page_id)
        page.status = status
        if build_log:
            page.build_log = build_log
        return self.repo.save(page)

    def start_build(self, page_id: UUID) -> Page:
        page = self.get(page_id)
        if page.status == "building":
            raise PageBuildInProgress(page_id)
        page.status = "building"
        page.build_log = ""
        return self.repo.save(page)

    def _validate_packages(self, packages: list[str]) -> None:
        for pkg in packages:
            if not PACKAGE_NAME_RE.match(pkg):
                raise InvalidPackageName(pkg)

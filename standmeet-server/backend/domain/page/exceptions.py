from __future__ import annotations

from uuid import UUID


class PageNotFound(Exception):
    def __init__(self, page_id: UUID):
        self.page_id = page_id
        super().__init__(f"Page not found: {page_id}")


class PageBuildInProgress(Exception):
    def __init__(self, page_id: UUID):
        self.page_id = page_id
        super().__init__(f"Page build already in progress: {page_id}")


class InvalidPackageName(Exception):
    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Invalid package name: {name}")

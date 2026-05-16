from __future__ import annotations

from domain.repo.entities import ContentEntry
from domain.repo.exceptions import ContentNotFound, InvalidPath
from domain.repo.repository import ContentRepository


class ContentService:
    def __init__(self, repo: ContentRepository):
        self.repo = repo

    def get(self, path: str) -> ContentEntry:
        entry = self.repo.get_by_path(path)
        if entry is None:
            raise ContentNotFound(path)
        return entry

    def list(self, prefix: str = "") -> list[ContentEntry]:
        return self.repo.list_by_prefix(prefix)

    def list_public(self, prefix: str = "") -> list[ContentEntry]:
        return self.repo.list_public(prefix)

    def upsert(
        self,
        path: str,
        content: dict,
        summary: str = "",
        content_type: str = "application/json",
        visibility: str | None = None,
        show_as_source: bool | None = None,
    ) -> ContentEntry:
        if not path or not path.startswith("/"):
            raise InvalidPath(path, "Path must start with /")
        # If visibility/show_as_source not provided, preserve existing or use defaults
        existing = None
        if visibility is None or show_as_source is None:
            existing = self.repo.get_by_path(path)
        if visibility is None:
            visibility = existing.visibility if existing else "private"
        if show_as_source is None:
            show_as_source = existing.show_as_source if existing else True
        entry = ContentEntry(
            path=path,
            content=content,
            summary=summary,
            content_type=content_type,
            visibility=visibility,
            show_as_source=show_as_source,
        )
        return self.repo.save(entry)

    def delete(self, path: str) -> bool:
        if not self.repo.delete(path):
            raise ContentNotFound(path)
        return True

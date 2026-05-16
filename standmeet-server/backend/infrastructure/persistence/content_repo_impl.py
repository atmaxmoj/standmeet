from __future__ import annotations

from domain.repo.entities import ContentEntry
from domain.repo.repository import ContentRepository
from infrastructure.persistence.models import ContentEntryModel


class DjangoContentRepository(ContentRepository):
    def _to_entity(self, model: ContentEntryModel) -> ContentEntry:
        return ContentEntry(
            id=model.id,
            path=model.path,
            content=model.content,
            summary=model.summary,
            content_type=model.content_type,
            visibility=model.visibility,
            show_as_source=model.show_as_source,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    def get_by_path(self, path: str) -> ContentEntry | None:
        try:
            model = ContentEntryModel.objects.get(path=path)
            return self._to_entity(model)
        except ContentEntryModel.DoesNotExist:
            return None

    def list_by_prefix(self, prefix: str) -> list[ContentEntry]:
        qs = ContentEntryModel.objects.all()
        if prefix:
            qs = qs.filter(path__startswith=prefix)
        return [self._to_entity(m) for m in qs]

    def get_public_by_path(self, path: str) -> ContentEntry | None:
        try:
            model = ContentEntryModel.objects.get(path=path, visibility="public")
            return self._to_entity(model)
        except ContentEntryModel.DoesNotExist:
            return None

    def list_public(self, prefix: str) -> list[ContentEntry]:
        qs = ContentEntryModel.objects.filter(visibility="public")
        if prefix:
            qs = qs.filter(path__startswith=prefix)
        return [self._to_entity(m) for m in qs]

    def save(self, entry: ContentEntry) -> ContentEntry:
        model, created = ContentEntryModel.objects.update_or_create(
            path=entry.path,
            defaults={
                "content": entry.content,
                "summary": entry.summary,
                "content_type": entry.content_type,
                "visibility": entry.visibility,
                "show_as_source": entry.show_as_source,
            },
            create_defaults={
                "id": entry.id,
                "content": entry.content,
                "summary": entry.summary,
                "content_type": entry.content_type,
                "visibility": entry.visibility,
                "show_as_source": entry.show_as_source,
            },
        )
        return self._to_entity(model)

    def delete(self, path: str) -> bool:
        count, _ = ContentEntryModel.objects.filter(path=path).delete()
        return count > 0

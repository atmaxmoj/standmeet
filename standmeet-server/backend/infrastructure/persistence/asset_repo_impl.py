from __future__ import annotations

from domain.asset.entities import Asset
from domain.asset.repository import AssetRepository
from infrastructure.persistence.models import AssetModel


class DjangoAssetRepository(AssetRepository):
    def _to_entity(self, model: AssetModel) -> Asset:
        return Asset(
            id=model.id,
            path=model.path,
            filename=model.filename,
            size=model.size,
            mime_type=model.mime_type,
            visibility=model.visibility,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    def get_by_path(self, path: str) -> Asset | None:
        try:
            model = AssetModel.objects.get(path=path)
            return self._to_entity(model)
        except AssetModel.DoesNotExist:
            return None

    def list_by_prefix(self, prefix: str) -> list[Asset]:
        qs = AssetModel.objects.all()
        if prefix:
            qs = qs.filter(path__startswith=prefix)
        return [self._to_entity(m) for m in qs]

    def list_public(self, prefix: str = "") -> list[Asset]:
        qs = AssetModel.objects.filter(visibility="public")
        if prefix:
            qs = qs.filter(path__startswith=prefix)
        return [self._to_entity(m) for m in qs]

    def save(self, asset: Asset) -> Asset:
        model, created = AssetModel.objects.update_or_create(
            path=asset.path,
            defaults={
                "filename": asset.filename,
                "size": asset.size,
                "mime_type": asset.mime_type,
                "visibility": asset.visibility,
            },
            create_defaults={
                "id": asset.id,
                "filename": asset.filename,
                "size": asset.size,
                "mime_type": asset.mime_type,
                "visibility": asset.visibility,
            },
        )
        return self._to_entity(model)

    def delete(self, path: str) -> bool:
        count, _ = AssetModel.objects.filter(path=path).delete()
        return count > 0

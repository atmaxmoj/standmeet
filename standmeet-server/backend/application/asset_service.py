from __future__ import annotations

from domain.asset.entities import Asset
from domain.asset.exceptions import AssetAlreadyExists, AssetNotFound, InvalidAssetPath
from domain.asset.repository import AssetRepository
from domain.asset.storage import AssetStorage


class AssetService:
    def __init__(self, repo: AssetRepository, storage: AssetStorage):
        self.repo = repo
        self.storage = storage

    def get(self, path: str) -> Asset:
        asset = self.repo.get_by_path(path)
        if asset is None:
            raise AssetNotFound(path)
        return asset

    def list(self, prefix: str = "", visibility: str = "") -> list[Asset]:
        if visibility == "public":
            return self.repo.list_public(prefix)
        return self.repo.list_by_prefix(prefix)

    def list_public(self, prefix: str = "") -> list[Asset]:
        return self.repo.list_public(prefix)

    def upload(
        self,
        path: str,
        filename: str,
        data: bytes,
        mime_type: str,
        visibility: str = "private",
    ) -> Asset:
        if not path or not path.startswith("/"):
            raise InvalidAssetPath(path, "Path must start with /")

        existing = self.repo.get_by_path(path)
        if existing is not None:
            raise AssetAlreadyExists(path)

        self.storage.upload(path, data, mime_type)

        asset = Asset(
            path=path,
            filename=filename,
            size=len(data),
            mime_type=mime_type,
            visibility=visibility,
        )
        return self.repo.save(asset)

    def replace(
        self,
        path: str,
        filename: str,
        data: bytes,
        mime_type: str,
    ) -> Asset:
        asset = self.repo.get_by_path(path)
        if asset is None:
            raise AssetNotFound(path)

        self.storage.upload(path, data, mime_type)

        asset.filename = filename
        asset.size = len(data)
        asset.mime_type = mime_type
        return self.repo.save(asset)

    def update_visibility(self, path: str, visibility: str) -> Asset:
        asset = self.repo.get_by_path(path)
        if asset is None:
            raise AssetNotFound(path)
        asset.visibility = visibility
        return self.repo.save(asset)

    def delete(self, path: str) -> bool:
        asset = self.repo.get_by_path(path)
        if asset is None:
            raise AssetNotFound(path)
        self.storage.delete(path)
        return self.repo.delete(path)

    def get_download_url(self, path: str) -> str:
        asset = self.repo.get_by_path(path)
        if asset is None:
            raise AssetNotFound(path)
        return self.storage.presigned_url(path)

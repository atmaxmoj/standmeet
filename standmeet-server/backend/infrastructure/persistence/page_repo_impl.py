from __future__ import annotations

from uuid import UUID

from domain.page.entities import Page, PageMeta
from domain.page.repository import PageRepository
from infrastructure.persistence.models import PageModel, RoleModel


class DjangoPageRepository(PageRepository):
    def _to_entity(self, model: PageModel) -> Page:
        meta_dict = model.meta or {}
        return Page(
            id=model.id,
            name=model.name,
            description=model.description,
            status=model.status,
            source_files=model.source_files or {},
            must_use=model.must_use or [],
            dont_use=model.dont_use or [],
            package_constraints=model.package_constraints,
            meta=PageMeta(
                title=meta_dict.get("title", ""),
                description=meta_dict.get("description", ""),
                favicon_asset_path=meta_dict.get("favicon_asset_path"),
                og_image_asset_path=meta_dict.get("og_image_asset_path"),
                custom_head=meta_dict.get("custom_head", ""),
            ),
            build_log=model.build_log,
            role_id=model.role_id,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    def _meta_to_dict(self, meta: PageMeta) -> dict:
        return {
            "title": meta.title,
            "description": meta.description,
            "favicon_asset_path": meta.favicon_asset_path,
            "og_image_asset_path": meta.og_image_asset_path,
            "custom_head": meta.custom_head,
        }

    def get_by_id(self, page_id: UUID) -> Page | None:
        try:
            model = PageModel.objects.get(id=page_id)
            return self._to_entity(model)
        except PageModel.DoesNotExist:
            return None

    def list_all(self) -> list[Page]:
        return [self._to_entity(m) for m in PageModel.objects.all()]

    def save(self, page: Page) -> Page:
        role_model = None
        if page.role_id is not None:
            try:
                role_model = RoleModel.objects.get(id=page.role_id)
            except RoleModel.DoesNotExist:
                pass

        model, _ = PageModel.objects.update_or_create(
            id=page.id,
            defaults={
                "name": page.name,
                "description": page.description,
                "status": page.status,
                "source_files": page.source_files,
                "must_use": page.must_use,
                "dont_use": page.dont_use,
                "package_constraints": page.package_constraints,
                "meta": self._meta_to_dict(page.meta),
                "build_log": page.build_log,
                "role": role_model,
            },
        )
        return self._to_entity(model)

    def delete(self, page_id: UUID) -> bool:
        count, _ = PageModel.objects.filter(id=page_id).delete()
        return count > 0

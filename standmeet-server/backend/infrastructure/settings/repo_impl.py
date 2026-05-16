from __future__ import annotations

from domain.settings.entities import SiteSettings
from domain.settings.repository import SettingsRepository
from infrastructure.settings.models import SiteSettingsModel


class DjangoSettingsRepository(SettingsRepository):
    def get(self) -> SiteSettings:
        model = SiteSettingsModel.load()
        extra = model.extra or {}
        return SiteSettings(
            public_access=model.public_access,
            ai_system_prompt=model.ai_system_prompt,
            im_integrations=extra.get("im_integrations", {}),
            extra=extra,
        )

    def save(self, settings: SiteSettings) -> SiteSettings:
        model = SiteSettingsModel.load()
        model.public_access = settings.public_access
        model.ai_system_prompt = settings.ai_system_prompt
        extra = model.extra or {}
        extra["im_integrations"] = settings.im_integrations
        model.extra = extra
        model.save()
        return settings

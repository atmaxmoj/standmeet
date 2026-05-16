from __future__ import annotations

from abc import ABC, abstractmethod

from domain.settings.entities import SiteSettings


class SettingsRepository(ABC):
    @abstractmethod
    def get(self) -> SiteSettings: ...

    @abstractmethod
    def save(self, settings: SiteSettings) -> SiteSettings: ...

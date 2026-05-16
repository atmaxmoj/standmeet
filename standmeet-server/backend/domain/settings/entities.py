from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SiteSettings:
    public_access: bool = False
    ai_system_prompt: str = ""
    im_integrations: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

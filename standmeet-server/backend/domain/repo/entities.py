from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ContentEntry:
    path: str
    content: dict
    summary: str = ""
    content_type: str = "application/json"
    visibility: str = "private"
    show_as_source: bool = True
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def __post_init__(self):
        # Normalize path: ensure leading slash, strip trailing slash
        if not self.path.startswith("/"):
            self.path = f"/{self.path}"
        self.path = self.path.rstrip("/") or "/"

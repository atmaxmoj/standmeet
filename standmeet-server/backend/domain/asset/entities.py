from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class Asset:
    path: str
    filename: str
    size: int
    mime_type: str
    visibility: str = "private"
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def __post_init__(self):
        if not self.path.startswith("/"):
            self.path = f"/{self.path}"
        self.path = self.path.rstrip("/") or "/"

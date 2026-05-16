from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4


@dataclass
class PageMeta:
    title: str = ""
    description: str = ""
    favicon_asset_path: str | None = None
    og_image_asset_path: str | None = None
    custom_head: str = ""


@dataclass
class Page:
    name: str
    description: str = ""
    status: str = "draft"  # "draft" | "building" | "ready" | "failed"
    source_files: dict = field(default_factory=dict)  # {"App.tsx": "...", ...}
    must_use: list[str] = field(default_factory=list)
    dont_use: list[str] = field(default_factory=list)
    package_constraints: str = ""
    meta: PageMeta = field(default_factory=PageMeta)
    build_log: str = ""
    role_id: UUID | None = None
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class BuilderConfig:
    install_timeout_s: int = 120
    build_timeout_s: int = 60
    memory_limit_mb: int = 512
    cpu_limit: float = 1.0


@dataclass
class BuildContext:
    source_files: dict[str, str]
    packages: list[str]
    content_data: list[dict]
    asset_manifest: dict[str, str]  # {path: download_url}
    page_id: str = ""
    meta: PageMeta = field(default_factory=PageMeta)
    builder_config: BuilderConfig = field(default_factory=BuilderConfig)


@dataclass
class BuildResult:
    status: str  # "success" | "failed"
    output_files: dict[str, bytes] = field(default_factory=dict)
    build_log: str = ""
    duration_ms: int = 0

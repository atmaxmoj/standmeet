from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4


@dataclass
class PathPermission:
    action: Literal["allow", "deny"]
    path_pattern: str  # glob pattern, e.g. /profile/*
    order: int = 0


@dataclass
class Role:
    name: str
    permissions: list[PathPermission] = field(default_factory=list)
    prompt: str = ""
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class McpServer:
    name: str
    config: dict = field(default_factory=dict)
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SkillScript:
    filename: str  # "extract.py"
    language: str  # "python" | "bash" | "javascript"
    content: str  # script source code
    description: str = ""  # becomes MCP tool description
    parameters: list[dict] = field(default_factory=list)


@dataclass
class Skill:
    name: str
    description: str = ""
    prompt: str = ""
    is_builtin: bool = False
    skill_md_raw: str = ""
    source: str = "manual"  # "manual" | "import" | "marketplace"
    version: str = ""
    license: str = ""
    compatibility: str = ""
    metadata: dict = field(default_factory=dict)
    allowed_tools: list[str] = field(default_factory=list)
    scripts: list[SkillScript] = field(default_factory=list)
    marketplace_id: str = ""
    marketplace_name: str = ""
    source_url: str = ""
    installed_version: str = ""
    latest_known_version: str = ""
    last_checked_at: datetime | None = None
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class InviteCode:
    code: str  # sm_xxxxx
    label: str  # "For Alice - recruiter"
    is_active: bool = True
    max_uses: int | None = None
    use_count: int = 0
    expires_at: datetime | None = None
    max_messages_per_session: int | None = None
    role_id: UUID | None = None
    prompt: str = ""
    greeting: str = ""
    page_id: UUID | None = None
    mcp_server_ids: list[UUID] = field(default_factory=list)
    skill_ids: list[UUID] = field(default_factory=list)
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def is_valid(self) -> bool:
        if not self.is_active:
            return False
        if self.max_uses is not None and self.use_count >= self.max_uses:
            return False
        if self.expires_at is not None and datetime.now(timezone.utc) >= self.expires_at:
            return False
        return True

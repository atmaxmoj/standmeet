from __future__ import annotations

from uuid import UUID


class InviteExpired(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(f"Invite code expired or invalid: {code}")


class AccessDenied(Exception):
    def __init__(self, path: str = ""):
        self.path = path
        super().__init__(f"Access denied{f': {path}' if path else ''}")


class McpServerInUseError(Exception):
    def __init__(self, server_id: "UUID"):
        self.server_id = server_id
        super().__init__(f"MCP server {server_id} is still referenced by invites")


class SkillInUseError(Exception):
    def __init__(self, skill_id: "UUID"):
        self.skill_id = skill_id
        super().__init__(f"Skill {skill_id} is still referenced by invites")


class BuiltinSkillError(Exception):
    def __init__(self, skill_id: "UUID"):
        self.skill_id = skill_id
        super().__init__(f"Cannot modify or delete built-in skill {skill_id}")

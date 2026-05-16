from __future__ import annotations

from domain.iam.entities import InviteCode, PathPermission
from domain.iam.repository import RoleRepository


def build_system_prompt(
    invite: InviteCode,
    role_repo: RoleRepository,
    global_prompt: str = "",
) -> str:
    """Build the combined system prompt from global, role, and invite-level prompts."""
    parts = []
    base = global_prompt or (
        "You are a helpful assistant representing the owner of this StandMeet profile. "
        "Use the available tools to find information about the owner and answer questions."
    )
    parts.append(base)
    # Role-level prompt
    if invite.role_id:
        role = role_repo.get(invite.role_id)
        if role and role.prompt:
            parts.append(role.prompt)
    # Invite-level prompt
    if invite.prompt:
        parts.append(invite.prompt)
    return "\n\n".join(parts)


def get_permissions(invite: InviteCode, role_repo: RoleRepository) -> list[PathPermission]:
    """Get the permissions for an invite based on its role."""
    if invite.role_id is None:
        return []
    role = role_repo.get(invite.role_id)
    if role is None:
        return []
    return role.permissions

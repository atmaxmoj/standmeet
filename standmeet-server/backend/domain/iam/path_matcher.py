from __future__ import annotations

from fnmatch import fnmatch

from domain.iam.entities import PathPermission


class PathMatcher:
    """Matches content paths against a list of permission rules (ordered, first-match wins)."""

    def __init__(self, permissions: list[PathPermission]):
        self.permissions = sorted(permissions, key=lambda p: p.order)

    def is_allowed(self, path: str) -> bool:
        for perm in self.permissions:
            if fnmatch(path, perm.path_pattern):
                return perm.action == "allow"
        # Default: deny if no rule matched
        return False

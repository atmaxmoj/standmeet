"""
SKILL.md format parser and serializer.

SKILL.md format:
---
name: My Skill
description: What this skill does
version: 1.0.0
license: MIT
compatibility: StandMeet >= 1.0
allowed_tools:
  - tool_a
  - tool_b
metadata:
  author: someone
  category: utility
---

Prompt body here (markdown).

Uses a minimal YAML subset parser (no external dependency).
Supports: scalar key-value pairs, list of scalars, one-level dict of scalars.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class SkillMdParseResult:
    name: str
    description: str
    prompt: str
    version: str = ""
    license: str = ""
    compatibility: str = ""
    metadata: dict = field(default_factory=dict)
    allowed_tools: list[str] = field(default_factory=list)


class SkillMdParseError(Exception):
    pass


def _unquote(s: str) -> str:
    """Strip surrounding quotes from a YAML scalar value."""
    if len(s) >= 2:
        if (s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'"):
            return s[1:-1]
    return s


def _finalize_pending(result, current_key, current_list, current_dict):
    """Store any pending list/dict collection into result."""
    if current_key and current_list is not None:
        result[current_key] = current_list
    elif current_key and current_dict is not None:
        result[current_key] = current_dict


def _handle_nested_item(indent_match, current_key, current_dict):
    """Handle an indented dict item. Returns (updated_dict, handled)."""
    k = indent_match.group(2)
    v = _unquote(indent_match.group(3).strip())
    if current_dict is not None:
        current_dict[k] = v
        return current_dict, True
    if current_key is not None:
        return {k: v}, True
    return current_dict, False


def _parse_frontmatter(text: str) -> dict:
    """Parse a minimal YAML subset: scalars, list items (- val), nested dicts (one level)."""
    result: dict = {}
    lines = text.split("\n")
    current_key: str | None = None
    current_list: list | None = None
    current_dict: dict | None = None

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        # List item: "  - value"
        if re.match(r"^\s+-\s+", line):
            value = _unquote(re.sub(r"^\s+-\s+", "", line).strip())
            if current_list is not None:
                current_list.append(value)
                continue
            if current_key is not None:
                current_list = [value]
                continue
            raise SkillMdParseError(f"Unexpected list item: {line}")

        # Nested dict item: "  key: value" (indented, under a parent key)
        indent_match = re.match(r"^(\s+)(\S+)\s*:\s*(.*)", line)
        if indent_match and len(indent_match.group(1)) >= 2:
            current_dict, handled = _handle_nested_item(
                indent_match, current_key, current_dict
            )
            if handled:
                continue

        # Top-level "key: value" or "key:" (block start)
        top_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)", line)
        if top_match:
            _finalize_pending(result, current_key, current_list, current_dict)
            key = top_match.group(1)
            value = top_match.group(2).strip()
            current_list = None
            current_dict = None
            if value:
                result[key] = _unquote(value)
                current_key = None
            else:
                current_key = key
            continue

        # Indented item under a block key that hasn't been typed yet
        if current_key and stripped:
            if stripped.startswith("- "):
                current_list = [_unquote(stripped[2:].strip())]
                continue
            kv = re.match(r"^(\S+)\s*:\s*(.*)", stripped)
            if kv:
                current_dict = {kv.group(1): _unquote(kv.group(2).strip())}
                continue

        raise SkillMdParseError(f"Cannot parse frontmatter line: {line}")

    _finalize_pending(result, current_key, current_list, current_dict)
    return result


def parse_skill_md(raw: str) -> SkillMdParseResult:
    """Parse a SKILL.md file: YAML frontmatter + markdown body."""
    stripped = raw.strip()
    if not stripped.startswith("---"):
        raise SkillMdParseError("SKILL.md must start with YAML frontmatter (---)")

    # Find closing ---
    end_idx = stripped.find("---", 3)
    if end_idx == -1:
        raise SkillMdParseError("SKILL.md frontmatter is not closed (missing ---)")

    frontmatter_str = stripped[3:end_idx].strip()
    body = stripped[end_idx + 3 :].strip()

    try:
        frontmatter = _parse_frontmatter(frontmatter_str)
    except SkillMdParseError:
        raise
    except Exception as e:
        raise SkillMdParseError(f"Invalid YAML frontmatter: {e}") from e

    if not isinstance(frontmatter, dict):
        raise SkillMdParseError("YAML frontmatter must be a mapping")

    name = frontmatter.get("name")
    if not name or not isinstance(name, str):
        raise SkillMdParseError("'name' is required in frontmatter")

    description = frontmatter.get("description", "")
    if not isinstance(description, str):
        description = str(description)

    version = frontmatter.get("version", "")
    if not isinstance(version, str):
        version = str(version)

    license_ = frontmatter.get("license", "")
    if not isinstance(license_, str):
        license_ = str(license_)

    compatibility = frontmatter.get("compatibility", "")
    if not isinstance(compatibility, str):
        compatibility = str(compatibility)

    metadata = frontmatter.get("metadata", {})
    if not isinstance(metadata, dict):
        raise SkillMdParseError("'metadata' must be a mapping")

    allowed_tools = frontmatter.get("allowed_tools", [])
    if not isinstance(allowed_tools, list):
        raise SkillMdParseError("'allowed_tools' must be a list")
    allowed_tools = [str(t) for t in allowed_tools]

    return SkillMdParseResult(
        name=name.strip(),
        description=description.strip(),
        prompt=body,
        version=version.strip(),
        license=license_.strip(),
        compatibility=compatibility.strip(),
        metadata=metadata,
        allowed_tools=allowed_tools,
    )


def _serialize_value(value: str) -> str:
    """Serialize a scalar value for YAML output."""
    # Quote if it contains special chars
    if any(c in value for c in ":#{}[]&*!|>'\",@`"):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    return value


def serialize_skill_md(
    *,
    name: str,
    description: str = "",
    prompt: str = "",
    version: str = "",
    license: str = "",
    compatibility: str = "",
    metadata: dict | None = None,
    allowed_tools: list[str] | None = None,
) -> str:
    """Generate a SKILL.md string from skill fields."""
    lines = ["---"]
    lines.append(f"name: {_serialize_value(name)}")

    if description:
        lines.append(f"description: {_serialize_value(description)}")
    if version:
        lines.append(f"version: {_serialize_value(version)}")
    if license:
        lines.append(f"license: {_serialize_value(license)}")
    if compatibility:
        lines.append(f"compatibility: {_serialize_value(compatibility)}")
    if allowed_tools:
        lines.append("allowed_tools:")
        for tool in allowed_tools:
            lines.append(f"  - {tool}")
    if metadata:
        lines.append("metadata:")
        for k, v in metadata.items():
            lines.append(f"  {k}: {_serialize_value(str(v))}")

    lines.append("---")

    if prompt:
        lines.append("")
        lines.append(prompt)

    return "\n".join(lines) + "\n"

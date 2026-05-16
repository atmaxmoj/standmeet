from __future__ import annotations

import io
import os
import zipfile
from uuid import UUID

from domain.iam.entities import Skill, SkillScript
from domain.iam.exceptions import BuiltinSkillError, SkillInUseError
from domain.iam.repository import SkillRepository
from domain.skill_md_parser import SkillMdParseError, parse_skill_md, serialize_skill_md


class SkillService:
    def __init__(self, repo: SkillRepository):
        self.repo = repo

    def create(
        self,
        name: str,
        description: str = "",
        prompt: str = "",
    ) -> Skill:
        skill = Skill(name=name, description=description, prompt=prompt)
        return self.repo.save(skill)

    def create_from_skill_md(self, raw: str, source: str = "import") -> Skill:
        """Parse a SKILL.md string and create a new Skill."""
        parsed = parse_skill_md(raw)
        skill = Skill(
            name=parsed.name,
            description=parsed.description,
            prompt=parsed.prompt,
            skill_md_raw=raw,
            source=source,
            version=parsed.version,
            license=parsed.license,
            compatibility=parsed.compatibility,
            metadata=parsed.metadata,
            allowed_tools=parsed.allowed_tools,
        )
        return self.repo.save(skill)

    def create_from_zip(self, zip_bytes: bytes, source: str = "import") -> Skill:
        """Parse a ZIP containing SKILL.md + scripts/ and create a Skill."""
        try:
            zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        except zipfile.BadZipFile:
            raise SkillMdParseError("Invalid ZIP file")

        # Find SKILL.md (may be at root or inside a single top-level dir)
        names = zf.namelist()
        skill_md_path = None
        prefix = ""
        for name in names:
            basename = os.path.basename(name)
            if basename.upper() == "SKILL.MD":
                skill_md_path = name
                prefix = name[: -len(basename)]
                break

        if not skill_md_path:
            raise SkillMdParseError("ZIP must contain a SKILL.md file")

        raw = zf.read(skill_md_path).decode("utf-8")
        parsed = parse_skill_md(raw)

        # Extract scripts from scripts/ directory
        scripts_dir = prefix + "scripts/"
        scripts: list[SkillScript] = []
        lang_map = {
            ".py": "python",
            ".sh": "bash",
            ".bash": "bash",
            ".js": "javascript",
            ".mjs": "javascript",
        }
        for name in names:
            if not name.startswith(scripts_dir):
                continue
            basename = os.path.basename(name)
            if not basename:
                continue  # directory entry
            _, ext = os.path.splitext(basename)
            language = lang_map.get(ext.lower(), ext.lstrip(".") or "unknown")
            content = zf.read(name).decode("utf-8")
            scripts.append(
                SkillScript(
                    filename=basename,
                    language=language,
                    content=content,
                )
            )

        skill = Skill(
            name=parsed.name,
            description=parsed.description,
            prompt=parsed.prompt,
            skill_md_raw=raw,
            source=source,
            version=parsed.version,
            license=parsed.license,
            compatibility=parsed.compatibility,
            metadata=parsed.metadata,
            allowed_tools=parsed.allowed_tools,
            scripts=scripts,
        )
        return self.repo.save(skill)

    def export_as_skill_md(self, id: UUID) -> str | None:
        """Export a skill as SKILL.md text. Returns raw if imported, generates otherwise."""
        skill = self.repo.get(id)
        if skill is None:
            return None
        # If the skill was imported and has original raw text, return it
        if skill.skill_md_raw:
            return skill.skill_md_raw
        # Generate from fields
        return serialize_skill_md(
            name=skill.name,
            description=skill.description,
            prompt=skill.prompt,
            version=skill.version,
            license=skill.license,
            compatibility=skill.compatibility,
            metadata=skill.metadata if skill.metadata else None,
            allowed_tools=skill.allowed_tools if skill.allowed_tools else None,
        )

    def list_all(self) -> list[Skill]:
        return self.repo.list_all()

    def get(self, id: UUID) -> Skill | None:
        return self.repo.get(id)

    def update(
        self,
        id: UUID,
        name: str | None = None,
        description: str | None = None,
        prompt: str | None = None,
    ) -> Skill | None:
        skill = self.repo.get(id)
        if skill is None:
            return None
        if skill.is_builtin:
            raise BuiltinSkillError(id)
        if name is not None:
            skill.name = name
        if description is not None:
            skill.description = description
        if prompt is not None:
            skill.prompt = prompt
        return self.repo.save(skill)

    def delete(self, id: UUID) -> bool:
        skill = self.repo.get(id)
        if skill is None:
            return False
        if skill.is_builtin:
            raise BuiltinSkillError(id)
        if self.repo.is_referenced(id):
            raise SkillInUseError(id)
        return self.repo.delete(id)

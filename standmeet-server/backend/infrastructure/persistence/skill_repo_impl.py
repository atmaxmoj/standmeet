from __future__ import annotations

from uuid import UUID

from domain.iam.entities import Skill, SkillScript
from domain.iam.repository import SkillRepository
from infrastructure.persistence.models import SkillModel, SkillScriptModel


class DjangoSkillRepository(SkillRepository):
    def _to_entity(self, model: SkillModel) -> Skill:
        scripts = [
            SkillScript(
                filename=s.filename,
                language=s.language,
                content=s.content,
                description=s.description,
                parameters=s.parameters or [],
            )
            for s in model.scripts.all()
        ]
        return Skill(
            id=model.id,
            name=model.name,
            description=model.description,
            prompt=model.prompt,
            is_builtin=model.is_builtin,
            skill_md_raw=model.skill_md_raw,
            source=model.source,
            version=model.version,
            license=model.license,
            compatibility=model.compatibility,
            metadata=model.skill_metadata or {},
            allowed_tools=model.allowed_tools or [],
            scripts=scripts,
            marketplace_id=model.marketplace_id,
            marketplace_name=model.marketplace_name,
            source_url=model.source_url,
            installed_version=model.installed_version,
            latest_known_version=model.latest_known_version,
            last_checked_at=model.last_checked_at,
            created_at=model.created_at,
        )

    def get(self, id: UUID) -> Skill | None:
        try:
            model = SkillModel.objects.get(id=id)
            return self._to_entity(model)
        except SkillModel.DoesNotExist:
            return None

    def get_by_name(self, name: str) -> Skill | None:
        try:
            model = SkillModel.objects.get(name=name)
            return self._to_entity(model)
        except SkillModel.DoesNotExist:
            return None

    def list_all(self) -> list[Skill]:
        qs = SkillModel.objects.all()
        return [self._to_entity(m) for m in qs]

    def save(self, skill: Skill) -> Skill:
        model, _ = SkillModel.objects.update_or_create(
            id=skill.id,
            defaults={
                "name": skill.name,
                "description": skill.description,
                "prompt": skill.prompt,
                "is_builtin": skill.is_builtin,
                "skill_md_raw": skill.skill_md_raw,
                "source": skill.source,
                "version": skill.version,
                "license": skill.license,
                "compatibility": skill.compatibility,
                "skill_metadata": skill.metadata,
                "allowed_tools": skill.allowed_tools,
                "marketplace_id": skill.marketplace_id,
                "marketplace_name": skill.marketplace_name,
                "source_url": skill.source_url,
                "installed_version": skill.installed_version,
                "latest_known_version": skill.latest_known_version,
                "last_checked_at": skill.last_checked_at,
            },
        )
        # Sync scripts: replace all
        if skill.scripts:
            model.scripts.all().delete()
            for script in skill.scripts:
                SkillScriptModel.objects.create(
                    skill=model,
                    filename=script.filename,
                    language=script.language,
                    content=script.content,
                    description=script.description,
                    parameters=script.parameters,
                )
        return self._to_entity(
            SkillModel.objects.get(id=skill.id)
        )

    def delete(self, id: UUID) -> bool:
        count, _ = SkillModel.objects.filter(id=id).delete()
        return count > 0

    def is_referenced(self, id: UUID) -> bool:
        try:
            model = SkillModel.objects.get(id=id)
            return model.invites.exists()
        except SkillModel.DoesNotExist:
            return False

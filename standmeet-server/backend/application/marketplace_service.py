"""Marketplace service — proxy for external skill marketplaces."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from domain.iam.entities import Skill

import httpx

from application.skill_service import SkillService
from domain.skill_md_parser import parse_skill_md

SKILLSMP_API_BASE = "https://api.skillsmp.com/v1"
GITHUB_SKILLS_BASE = "https://api.github.com/repos/anthropics/skills"

# Simple in-memory cache: key -> (data, expiry_timestamp)
_cache: dict[str, tuple[Any, float]] = {}
CACHE_TTL_DIRECTORY = 600  # 10 min for directory listing
CACHE_TTL_SKILL_MD = 1800  # 30 min for SKILL.md content


def _cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry and entry[1] > time.monotonic():
        return entry[0]
    _cache.pop(key, None)
    return None


def _cache_set(key: str, value: Any, ttl: int) -> None:
    _cache[key] = (value, time.monotonic() + ttl)


@dataclass
class MarketplaceSkill:
    """A skill listing from a marketplace."""
    id: str
    name: str
    description: str
    author: str = ""
    stars: int = 0
    category: str = ""
    version: str = ""
    marketplace: str = ""  # "skillsmp" | "github"
    source_url: str = ""


class MarketplaceError(Exception):
    pass


class MarketplaceService:
    def __init__(self, skill_service: SkillService):
        self.skill_service = skill_service

    async def search(
        self,
        query: str = "",
        marketplace: str = "all",
    ) -> list[MarketplaceSkill]:
        """Search for skills across marketplaces."""
        results: list[MarketplaceSkill] = []

        if marketplace in ("all", "skillsmp"):
            try:
                results.extend(await self._search_skillsmp(query))
            except Exception:
                pass  # Marketplace unavailable, skip

        if marketplace in ("all", "github"):
            try:
                results.extend(await self._search_github(query))
            except Exception:
                pass  # GitHub unavailable, skip

        return results

    async def get_skill_md(self, marketplace: str, skill_id: str) -> str:
        """Download the SKILL.md content from a marketplace."""
        if marketplace == "skillsmp":
            return await self._get_skillsmp_skill_md(skill_id)
        elif marketplace == "github":
            return await self._get_github_skill_md(skill_id)
        else:
            raise MarketplaceError(f"Unknown marketplace: {marketplace}")

    def install(
        self,
        skill_md_raw: str,
        marketplace: str,
        marketplace_id: str,
        source_url: str = "",
    ) -> Skill:
        """Parse SKILL.md and create a local skill with marketplace metadata."""
        from domain.iam.entities import Skill

        parsed = parse_skill_md(skill_md_raw)
        skill = Skill(
            name=parsed.name,
            description=parsed.description,
            prompt=parsed.prompt,
            skill_md_raw=skill_md_raw,
            source="marketplace",
            version=parsed.version,
            license=parsed.license,
            compatibility=parsed.compatibility,
            metadata=parsed.metadata,
            allowed_tools=parsed.allowed_tools,
            marketplace_id=marketplace_id,
            marketplace_name=marketplace,
            source_url=source_url,
            installed_version=parsed.version,
        )
        return self.skill_service.repo.save(skill)

    def check_updates(self) -> list[dict]:
        """Check all marketplace-installed skills for updates. Returns list of {skill_id, name, installed, latest}."""
        # This is a sync operation that queries all marketplace skills
        skills = self.skill_service.list_all()
        updates = []
        for skill in skills:
            if skill.source == "marketplace" and skill.latest_known_version and skill.installed_version:
                if skill.latest_known_version != skill.installed_version:
                    updates.append({
                        "skill_id": str(skill.id),
                        "name": skill.name,
                        "installed_version": skill.installed_version,
                        "latest_version": skill.latest_known_version,
                    })
        return updates

    async def _search_skillsmp(self, query: str) -> list[MarketplaceSkill]:
        """Search SkillsMP marketplace."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{SKILLSMP_API_BASE}/skills/search",
                params={"q": query} if query else {},
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data.get("skills", []):
            results.append(MarketplaceSkill(
                id=str(item.get("id", "")),
                name=item.get("name", ""),
                description=item.get("description", ""),
                author=item.get("author", ""),
                stars=item.get("stars", 0),
                category=item.get("category", ""),
                version=item.get("version", ""),
                marketplace="skillsmp",
                source_url=item.get("url", ""),
            ))
        return results

    async def _search_github(self, query: str) -> list[MarketplaceSkill]:
        """Search GitHub anthropics/skills repo."""
        cache_key = "github:directory"
        data = _cache_get(cache_key)
        if data is None:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{GITHUB_SKILLS_BASE}/contents/skills",
                    headers={"Accept": "application/vnd.github.v3+json"},
                )
                if resp.status_code == 404:
                    return []
                resp.raise_for_status()
                data = resp.json()
            _cache_set(cache_key, data, CACHE_TTL_DIRECTORY)

        results = []
        for item in data:
            if item.get("type") != "dir":
                continue
            name = item.get("name", "")
            if query and query.lower() not in name.lower():
                continue
            results.append(MarketplaceSkill(
                id=name,
                name=name,
                description="",
                marketplace="github",
                source_url=item.get("html_url", ""),
            ))
        return results

    async def _get_skillsmp_skill_md(self, skill_id: str) -> str:
        """Download SKILL.md from SkillsMP."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{SKILLSMP_API_BASE}/skills/{skill_id}/skill.md")
            resp.raise_for_status()
            return resp.text

    async def _get_github_skill_md(self, skill_id: str) -> str:
        """Download SKILL.md from GitHub anthropics/skills."""
        cache_key = f"github:skill_md:{skill_id}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        raw_url = f"https://raw.githubusercontent.com/anthropics/skills/main/skills/{skill_id}/SKILL.md"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(raw_url)
            resp.raise_for_status()
            text = resp.text
        _cache_set(cache_key, text, CACHE_TTL_SKILL_MD)
        return text

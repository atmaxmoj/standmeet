"""Marketplace API endpoints — proxy for external skill marketplaces."""

from __future__ import annotations

import asyncio

from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.marketplace_service import MarketplaceError, MarketplaceService
from application.skill_service import SkillService
from domain.skill_md_parser import SkillMdParseError
from infrastructure.persistence.skill_repo_impl import DjangoSkillRepository
from interfaces.api.skill_serializers import SkillSerializer


def _get_marketplace_service() -> MarketplaceService:
    skill_service = SkillService(DjangoSkillRepository())
    return MarketplaceService(skill_service)


class MarketplaceSkillSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField()
    author = serializers.CharField()
    stars = serializers.IntegerField()
    category = serializers.CharField()
    version = serializers.CharField()
    marketplace = serializers.CharField()
    source_url = serializers.CharField()


class MarketplaceInstallSerializer(serializers.Serializer):
    marketplace = serializers.CharField()
    skill_id = serializers.CharField()


def _run_async(coro):
    """Run an async coroutine from sync context."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We're in an async context (uvicorn), create a task
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def marketplace_search(request):
    query = request.query_params.get("q", "")
    source = request.query_params.get("source", "all")
    service = _get_marketplace_service()

    try:
        results = _run_async(service.search(query, marketplace=source))
    except Exception as e:
        return Response(
            {"error": f"Marketplace search failed: {e}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    serializer = MarketplaceSkillSerializer(results, many=True)
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def marketplace_detail(request, marketplace, skill_id):
    service = _get_marketplace_service()

    try:
        skill_md = _run_async(service.get_skill_md(marketplace, skill_id))
    except MarketplaceError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response(
            {"error": f"Failed to fetch skill details: {e}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response({"skill_md": skill_md, "marketplace": marketplace, "skill_id": skill_id})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def marketplace_install(request):
    serializer = MarketplaceInstallSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    marketplace = serializer.validated_data["marketplace"]
    skill_id = serializer.validated_data["skill_id"]
    service = _get_marketplace_service()

    # Download SKILL.md
    try:
        skill_md = _run_async(service.get_skill_md(marketplace, skill_id))
    except MarketplaceError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response(
            {"error": f"Failed to download skill: {e}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    # Install locally
    try:
        skill = service.install(
            skill_md_raw=skill_md,
            marketplace=marketplace,
            marketplace_id=skill_id,
        )
    except SkillMdParseError as e:
        return Response({"error": f"Invalid SKILL.md: {e}"}, status=status.HTTP_400_BAD_REQUEST)

    return Response(SkillSerializer(skill).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def marketplace_check_updates(request):
    service = _get_marketplace_service()
    updates = service.check_updates()
    return Response(updates)

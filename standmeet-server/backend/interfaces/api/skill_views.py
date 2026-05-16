from uuid import UUID

import httpx
from rest_framework import serializers, status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.skill_service import SkillService
from domain.iam.exceptions import BuiltinSkillError, SkillInUseError
from domain.skill_md_parser import SkillMdParseError
from infrastructure.persistence.skill_repo_impl import DjangoSkillRepository
from interfaces.api.skill_serializers import (
    SkillImportSerializer,
    SkillSerializer,
    SkillUpdateSerializer,
)


def _get_service() -> SkillService:
    return SkillService(DjangoSkillRepository())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def skill_list(request):
    service = _get_service()

    if request.method == "GET":
        skills = service.list_all()
        serializer = SkillSerializer(skills, many=True)
        return Response(serializer.data)

    # POST — create
    serializer = SkillSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    skill = service.create(
        name=data["name"],
        description=data.get("description", ""),
        prompt=data.get("prompt", ""),
    )
    return Response(SkillSerializer(skill).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def skill_detail(request, skill_id):
    service = _get_service()

    if request.method == "GET":
        skill = service.get(UUID(str(skill_id)))
        if skill is None:
            return Response({"error": "Skill not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(SkillSerializer(skill).data)

    elif request.method == "PATCH":
        serializer = SkillUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        kwargs = {}
        if "name" in data:
            kwargs["name"] = data["name"]
        if "description" in data:
            kwargs["description"] = data["description"]
        if "prompt" in data:
            kwargs["prompt"] = data["prompt"]

        try:
            skill = service.update(UUID(str(skill_id)), **kwargs)
        except BuiltinSkillError:
            return Response(
                {"error": "Cannot modify a built-in skill"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if skill is None:
            return Response({"error": "Skill not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(SkillSerializer(skill).data)

    elif request.method == "DELETE":
        try:
            if not service.delete(UUID(str(skill_id))):
                return Response({"error": "Skill not found"}, status=status.HTTP_404_NOT_FOUND)
        except BuiltinSkillError:
            return Response(
                {"error": "Cannot delete a built-in skill"},
                status=status.HTTP_403_FORBIDDEN,
            )
        except SkillInUseError:
            return Response(
                {"error": "Skill is still referenced by invites"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def skill_import(request):
    serializer = SkillImportSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    raw = serializer.validated_data["skill_md_raw"]
    service = _get_service()
    try:
        skill = service.create_from_skill_md(raw, source="import")
    except SkillMdParseError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(SkillSerializer(skill).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def skill_import_zip(request):
    uploaded = request.FILES.get("file")
    if not uploaded:
        return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
    service = _get_service()
    try:
        skill = service.create_from_zip(uploaded.read(), source="import")
    except SkillMdParseError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(SkillSerializer(skill).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def skill_export(request, skill_id):
    service = _get_service()
    result = service.export_as_skill_md(UUID(str(skill_id)))
    if result is None:
        return Response({"error": "Skill not found"}, status=status.HTTP_404_NOT_FOUND)
    return Response({"skill_md": result})


class SkillImportUrlSerializer(serializers.Serializer):
    url = serializers.CharField()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def skill_import_url(request):
    """Fetch a SKILL.md from a URL and import it."""
    serializer = SkillImportUrlSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    url = serializer.validated_data["url"]

    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        raw = resp.text
    except httpx.HTTPStatusError as e:
        return Response(
            {"error": f"Failed to fetch: HTTP {e.response.status_code}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except httpx.RequestError as e:
        return Response(
            {"error": f"Failed to fetch: {e}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    service = _get_service()
    try:
        skill = service.create_from_skill_md(raw, source="url")
    except SkillMdParseError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(SkillSerializer(skill).data, status=status.HTTP_201_CREATED)

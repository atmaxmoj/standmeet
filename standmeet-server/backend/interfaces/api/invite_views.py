from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.invite_service import InviteService
from domain.iam.exceptions import InviteExpired
from infrastructure.persistence.invite_repo_impl import DjangoInviteRepository
from interfaces.api.invite_serializers import (
    InviteCodeSerializer,
    InviteUpdateSerializer,
)


def _get_service() -> InviteService:
    return InviteService(DjangoInviteRepository())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def invite_list(request):
    service = _get_service()

    if request.method == "GET":
        invites = service.list_all()
        serializer = InviteCodeSerializer(invites, many=True)
        return Response(serializer.data)

    # POST — create
    serializer = InviteCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    invite = service.create(
        label=data["label"],
        role_id=data.get("role_id"),
        max_uses=data.get("max_uses"),
        max_messages_per_session=data.get("max_messages_per_session"),
        expires_in_hours=data.get("expires_in_hours"),
        prompt=data.get("prompt", ""),
        greeting=data.get("greeting", ""),
        page_id=data.get("page_id"),
        mcp_server_ids=data.get("mcp_server_ids", []),
        skill_ids=data.get("skill_ids", []),
    )
    return Response(InviteCodeSerializer(invite).data, status=status.HTTP_201_CREATED)


def _apply_invite_patch(service, invite, data):
    """Apply validated patch fields to an invite, returning an error Response or None."""
    simple_fields = [
        "label", "prompt", "greeting", "role_id",
        "max_messages_per_session", "mcp_server_ids", "skill_ids", "page_id",
    ]
    for field in simple_fields:
        if field in data:
            setattr(invite, field, data[field])
            service.repo.save(invite)

    if "is_active" in data and not data["is_active"]:
        service.revoke(invite.code)

    if "max_uses" in data:
        val = data["max_uses"]
        if val is not None and val < invite.use_count:
            return Response(
                {"error": f"Cannot set max_uses below current usage ({invite.use_count})"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invite.max_uses = val
        service.repo.save(invite)

    return None


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def invite_detail(request, code):
    service = _get_service()

    if request.method == "PATCH":
        serializer = InviteUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            invite = service.get(code)
        except InviteExpired:
            return Response({"error": "Invite not found"}, status=status.HTTP_404_NOT_FOUND)

        error_response = _apply_invite_patch(service, invite, serializer.validated_data)
        if error_response:
            return error_response

        invite = service.get(code)
        return Response(InviteCodeSerializer(invite).data)

    elif request.method == "DELETE":
        repo = DjangoInviteRepository()
        if not repo.delete(code):
            return Response({"error": "Invite not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)

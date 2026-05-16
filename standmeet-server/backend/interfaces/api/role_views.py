from uuid import UUID

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.role_service import RoleInUseError, RoleService
from infrastructure.persistence.role_repo_impl import DjangoRoleRepository
from interfaces.api.role_serializers import RoleSerializer, RoleUpdateSerializer


def _get_service() -> RoleService:
    return RoleService(DjangoRoleRepository())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def role_list(request):
    service = _get_service()

    if request.method == "GET":
        roles = service.list_all()
        serializer = RoleSerializer(roles, many=True)
        return Response(serializer.data)

    # POST — create
    serializer = RoleSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    role = service.create(
        name=data["name"],
        permissions=[dict(p) for p in data.get("permissions", [])],
        prompt=data.get("prompt", ""),
    )
    return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def role_detail(request, role_id):
    service = _get_service()

    if request.method == "GET":
        role = service.get(UUID(str(role_id)))
        if role is None:
            return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(RoleSerializer(role).data)

    elif request.method == "PATCH":
        serializer = RoleUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        kwargs = {}
        if "name" in data:
            kwargs["name"] = data["name"]
        if "permissions" in data:
            kwargs["permissions"] = [dict(p) for p in data["permissions"]]
        if "prompt" in data:
            kwargs["prompt"] = data["prompt"]

        role = service.update(UUID(str(role_id)), **kwargs)
        if role is None:
            return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(RoleSerializer(role).data)

    elif request.method == "DELETE":
        try:
            if not service.delete(UUID(str(role_id))):
                return Response({"error": "Role not found"}, status=status.HTTP_404_NOT_FOUND)
        except RoleInUseError:
            return Response(
                {"error": "Role is still referenced by invites"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

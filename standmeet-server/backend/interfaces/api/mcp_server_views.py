from uuid import UUID

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.mcp_server_service import McpServerService
from domain.iam.exceptions import McpServerInUseError
from infrastructure.persistence.mcp_server_repo_impl import DjangoMcpServerRepository
from interfaces.api.mcp_server_serializers import (
    McpServerSerializer,
    McpServerUpdateSerializer,
)


def _get_service() -> McpServerService:
    return McpServerService(DjangoMcpServerRepository())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def mcp_server_list(request):
    service = _get_service()

    if request.method == "GET":
        servers = service.list_all()
        serializer = McpServerSerializer(servers, many=True)
        return Response(serializer.data)

    # POST — create
    serializer = McpServerSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    server = service.create(
        name=data["name"],
        config=data.get("config", {}),
    )
    return Response(McpServerSerializer(server).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def mcp_server_detail(request, server_id):
    service = _get_service()

    if request.method == "GET":
        server = service.get(UUID(str(server_id)))
        if server is None:
            return Response({"error": "MCP server not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(McpServerSerializer(server).data)

    elif request.method == "PATCH":
        serializer = McpServerUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        kwargs = {}
        if "name" in data:
            kwargs["name"] = data["name"]
        if "config" in data:
            kwargs["config"] = data["config"]

        server = service.update(UUID(str(server_id)), **kwargs)
        if server is None:
            return Response({"error": "MCP server not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(McpServerSerializer(server).data)

    elif request.method == "DELETE":
        try:
            if not service.delete(UUID(str(server_id))):
                return Response({"error": "MCP server not found"}, status=status.HTTP_404_NOT_FOUND)
        except McpServerInUseError:
            return Response(
                {"error": "MCP server is still referenced by invites"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

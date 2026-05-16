from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.content_service import ContentService
from domain.repo.exceptions import ContentNotFound, InvalidPath
from infrastructure.persistence.content_repo_impl import DjangoContentRepository
from interfaces.api.content_serializers import ContentEntrySerializer, ContentListSerializer


def _get_service() -> ContentService:
    return ContentService(DjangoContentRepository())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def content_list(request):
    service = _get_service()

    if request.method == "GET":
        prefix = request.query_params.get("prefix", "")
        visibility = request.query_params.get("visibility", "")
        if visibility == "public":
            entries = service.list_public(prefix)
        else:
            entries = service.list(prefix)
        serializer = ContentListSerializer(entries, many=True)
        return Response(serializer.data)

    # POST — create
    serializer = ContentEntrySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        entry = service.upsert(
            path=serializer.validated_data["path"],
            content=serializer.validated_data["content"],
            summary=serializer.validated_data.get("summary", ""),
            content_type=serializer.validated_data.get("content_type", "application/json"),
            visibility=serializer.validated_data.get("visibility", "private"),
            show_as_source=serializer.validated_data.get("show_as_source", True),
        )
        return Response(ContentEntrySerializer(entry).data, status=status.HTTP_201_CREATED)
    except InvalidPath as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def content_detail(request, path):
    service = _get_service()
    full_path = f"/{path}"

    if request.method == "GET":
        try:
            entry = service.get(full_path)
            return Response(ContentEntrySerializer(entry).data)
        except ContentNotFound:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    elif request.method == "PUT":
        serializer = ContentEntrySerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        # Only pass visibility if explicitly provided in request
        kwargs = dict(
            path=full_path,
            content=serializer.validated_data.get("content", {}),
            summary=serializer.validated_data.get("summary", ""),
            content_type=serializer.validated_data.get("content_type", "application/json"),
        )
        if "visibility" in request.data:
            kwargs["visibility"] = serializer.validated_data["visibility"]
        if "show_as_source" in request.data:
            kwargs["show_as_source"] = serializer.validated_data["show_as_source"]
        try:
            entry = service.upsert(**kwargs)
            return Response(ContentEntrySerializer(entry).data)
        except InvalidPath as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        try:
            service.delete(full_path)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ContentNotFound:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

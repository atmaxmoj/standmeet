from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.asset_service import AssetService
from domain.asset.exceptions import AssetAlreadyExists, AssetNotFound, InvalidAssetPath
from infrastructure.persistence.asset_repo_impl import DjangoAssetRepository
from infrastructure.storage.s3_client import MinioAssetStorage
from interfaces.api.asset_serializers import (
    AssetListSerializer,
    AssetSerializer,
    AssetVisibilitySerializer,
)


def _get_service() -> AssetService:
    return AssetService(DjangoAssetRepository(), MinioAssetStorage())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def asset_list(request):
    service = _get_service()

    if request.method == "GET":
        prefix = request.query_params.get("prefix", "")
        visibility = request.query_params.get("visibility", "")
        assets = service.list(prefix, visibility)
        serializer = AssetListSerializer(assets, many=True)
        return Response(serializer.data)

    # POST — upload
    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)

    path = request.data.get("path", "")
    visibility = request.data.get("visibility", "private")

    if not path:
        return Response({"error": "Path is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        data = file.read()
        asset = service.upload(
            path=path,
            filename=file.name,
            data=data,
            mime_type=file.content_type or "application/octet-stream",
            visibility=visibility,
        )
        result = AssetSerializer(asset).data
        return Response(result, status=status.HTTP_201_CREATED)
    except InvalidAssetPath as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except AssetAlreadyExists as e:
        return Response({"error": str(e)}, status=status.HTTP_409_CONFLICT)


@api_view(["GET", "PATCH", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def asset_detail(request, path):
    service = _get_service()
    full_path = f"/{path}"

    if request.method == "GET":
        try:
            asset = service.get(full_path)
            download_url = service.get_download_url(full_path)
            data = AssetSerializer(asset).data
            data["download_url"] = download_url
            return Response(data)
        except AssetNotFound:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    elif request.method == "PATCH":
        serializer = AssetVisibilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            asset = service.update_visibility(full_path, serializer.validated_data["visibility"])
            return Response(AssetSerializer(asset).data)
        except AssetNotFound:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    elif request.method == "PUT":
        file = request.FILES.get("file")
        if not file:
            return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = file.read()
            asset = service.replace(
                path=full_path,
                filename=file.name,
                data=data,
                mime_type=file.content_type or "application/octet-stream",
            )
            return Response(AssetSerializer(asset).data)
        except AssetNotFound:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    elif request.method == "DELETE":
        try:
            service.delete(full_path)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except AssetNotFound:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

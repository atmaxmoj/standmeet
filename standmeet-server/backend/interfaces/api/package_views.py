import logging

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.package_service import InvalidPackageName, PackageService
from infrastructure.packages.npm_package_manager import NpmPackageManager

logger = logging.getLogger(__name__)


def _get_service() -> PackageService:
    return PackageService(NpmPackageManager())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def package_list(request):
    service = _get_service()

    if request.method == "GET":
        packages = service.list_packages()
        return Response([{"name": p.name, "version": p.version} for p in packages])

    # POST — install
    name = request.data.get("name", "").strip()
    if not name:
        return Response({"error": "Package name is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        pkg = service.install_package(name)
        return Response({"name": pkg.name, "version": pkg.version}, status=status.HTTP_201_CREATED)
    except InvalidPackageName as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except RuntimeError as e:
        logger.exception("Package install failed: %s", name)
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def package_detail(request, name):
    service = _get_service()
    try:
        service.uninstall_package(name)
        return Response(status=status.HTTP_204_NO_CONTENT)
    except RuntimeError as e:
        logger.exception("Package uninstall failed: %s", name)
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

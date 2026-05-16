import logging
import shutil

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

logger = logging.getLogger(__name__)


def _get_storage_usage() -> tuple[int, int]:
    """Returns (used_bytes, total_bytes) for the server's root filesystem."""
    usage = shutil.disk_usage("/")
    return usage.used, usage.total


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def storage_usage_view(request):
    try:
        used_bytes, total_bytes = _get_storage_usage()
        return Response({
            "used_bytes": used_bytes,
            "total_bytes": total_bytes,
        })
    except Exception:
        logger.exception("Failed to get storage usage")
        return Response({
            "used_bytes": 0,
            "total_bytes": 0,
        })

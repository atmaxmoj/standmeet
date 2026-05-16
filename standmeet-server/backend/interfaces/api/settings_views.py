from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from infrastructure.persistence.models import ContentEntryModel, InviteCodeModel
from infrastructure.settings.repo_impl import DjangoSettingsRepository
from interfaces.api.settings_serializers import SiteSettingsSerializer


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def settings_view(request):
    repo = DjangoSettingsRepository()

    if request.method == "GET":
        settings = repo.get()
        serializer = SiteSettingsSerializer(settings)
        return Response(serializer.data)

    # PATCH
    serializer = SiteSettingsSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    current = repo.get()
    for key, value in serializer.validated_data.items():
        setattr(current, key, value)
    repo.save(current)
    return Response(SiteSettingsSerializer(current).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def status_view(request):
    repo = DjangoSettingsRepository()
    settings = repo.get()

    # Get storage usage (disk space)
    storage_used_bytes = 0
    storage_total_bytes = 0
    try:
        from interfaces.api.storage_views import _get_storage_usage
        storage_used_bytes, storage_total_bytes = _get_storage_usage()
    except Exception:
        pass

    data = {
        "version": "0.1.0",
        "content_count": ContentEntryModel.objects.count(),
        "active_invites": InviteCodeModel.objects.filter(is_active=True).count(),
        "public_access": settings.public_access,
        "storage_used_bytes": storage_used_bytes,
        "storage_total_bytes": storage_total_bytes,
    }
    return Response(data)

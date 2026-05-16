import asyncio
import logging
import threading

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from application.page_build_orchestrator import PageBuildOrchestrator
from application.page_service import PageService
from domain.page.exceptions import InvalidPackageName, PageBuildInProgress, PageNotFound
from infrastructure.build.dev_workspace import (
    get_active_page_id,
    set_active_page_id,
    write_source_files,
)
from infrastructure.build.remote_builder import RemotePageBuilder
from infrastructure.packages.npm_package_manager import NpmPackageManager
from infrastructure.persistence.asset_repo_impl import DjangoAssetRepository
from infrastructure.persistence.content_repo_impl import DjangoContentRepository
from infrastructure.persistence.page_repo_impl import DjangoPageRepository
from infrastructure.storage.s3_client import MinioAssetStorage
from interfaces.api.page_serializers import (
    PageListSerializer,
    PageSerializer,
    PageUpdateSerializer,
)

logger = logging.getLogger(__name__)


def _get_service() -> PageService:
    return PageService(DjangoPageRepository())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def page_list(request):
    service = _get_service()

    if request.method == "GET":
        pages = service.list_all()
        serializer = PageListSerializer(pages, many=True)
        return Response(serializer.data)

    # POST — create
    serializer = PageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    meta = data.get("meta")
    if isinstance(meta, dict):
        meta_dict = meta
    elif meta is not None:
        # OrderedDict from nested serializer
        meta_dict = dict(meta)
    else:
        meta_dict = None

    try:
        page = service.create(
            name=data["name"],
            description=data.get("description", ""),
            source_files=data.get("source_files"),
            must_use=data.get("must_use"),
            dont_use=data.get("dont_use"),
            package_constraints=data.get("package_constraints", ""),
            meta=meta_dict,
            role_id=data.get("role_id"),
        )
        return Response(PageSerializer(page).data, status=status.HTTP_201_CREATED)
    except InvalidPackageName as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def page_detail(request, page_id):
    service = _get_service()

    if request.method == "GET":
        try:
            page = service.get(page_id)
            return Response(PageSerializer(page).data)
        except PageNotFound:
            return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)

    elif request.method == "PATCH":
        serializer = PageUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Convert meta OrderedDict to dict if present
        if "meta" in data and not isinstance(data["meta"], dict):
            data["meta"] = dict(data["meta"])

        try:
            page = service.update(page_id, **data)
            # Sync source files to dev workspace if this is the active page
            if get_active_page_id() == str(page_id) and "source_files" in data:
                write_source_files(page.source_files or {})
            return Response(PageSerializer(page).data)
        except PageNotFound:
            return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)
        except InvalidPackageName as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        try:
            service.delete(page_id)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except PageNotFound:
            return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)


def _run_build_in_background(page_id):
    """Run the page build in a background thread."""
    import os

    import django

    # Allow synchronous ORM calls inside this thread's async event loop.
    # This thread is isolated and does not serve requests, so it is safe.
    os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
    django.setup()

    page_repo = DjangoPageRepository()
    page = page_repo.get_by_id(page_id)
    if page is None:
        return

    orchestrator = PageBuildOrchestrator(
        builder=RemotePageBuilder(),
        page_repo=page_repo,
        content_repo=DjangoContentRepository(),
        asset_repo=DjangoAssetRepository(),
        asset_storage=MinioAssetStorage(),
        package_repo=NpmPackageManager(),
    )

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(orchestrator.build_page(page))
    except Exception:
        logger.exception("Background build failed for page %s", page_id)
        page = page_repo.get_by_id(page_id)
        if page and page.status == "building":
            page.status = "failed"
            page.build_log = "Build failed unexpectedly."
            page_repo.save(page)
    finally:
        loop.close()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def page_build(request, page_id):
    service = _get_service()
    try:
        page = service.start_build(page_id)

        # Kick off build in background thread
        thread = threading.Thread(
            target=_run_build_in_background,
            args=(page_id,),
            daemon=True,
        )
        thread.start()

        return Response({"status": page.status, "id": str(page.id)})
    except PageNotFound:
        return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)
    except PageBuildInProgress:
        return Response(
            {"error": "Build already in progress"},
            status=status.HTTP_409_CONFLICT,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def page_build_log(request, page_id):
    service = _get_service()
    try:
        page = service.get(page_id)
        return Response({"build_log": page.build_log, "status": page.status})
    except PageNotFound:
        return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def page_activate(request, page_id):
    """Activate a page for dev preview — writes its source_files to the shared volume."""
    service = _get_service()
    try:
        page = service.get(page_id)
        write_source_files(page.source_files or {})
        set_active_page_id(str(page_id))
        return Response({"activated": str(page_id)})
    except PageNotFound:
        return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)


@api_view(["GET"])
@permission_classes([AllowAny])
def page_dev_data(request):
    """Return content data for the currently active dev page (dev only, no auth required)."""
    active_page_id = get_active_page_id()
    if active_page_id is None:
        return Response({"content": [], "assets": {}})

    service = _get_service()
    try:
        page = service.get(active_page_id)
    except PageNotFound:
        set_active_page_id(None)
        return Response({"content": [], "assets": {}})

    # Gather content and assets for this page (same as build orchestrator)
    content_repo = DjangoContentRepository()
    asset_repo = DjangoAssetRepository()
    asset_storage = MinioAssetStorage()

    # Get content entries (filtered by role if applicable)
    content_data = []
    if page.role_id:
        from domain.iam.path_matcher import PathMatcher
        from infrastructure.persistence.role_repo_impl import DjangoRoleRepository

        role_repo = DjangoRoleRepository()
        role = role_repo.get(page.role_id)
        entries = content_repo.list_by_prefix("")
        if role and role.permissions:
            matcher = PathMatcher(role.permissions)
            entries = [e for e in entries if matcher.is_allowed(e.path)]
        content_data = [
            {"path": e.path, "content": e.content, "summary": e.summary}
            for e in entries
        ]
    else:
        entries = content_repo.list_by_prefix("")
        content_data = [
            {"path": e.path, "content": e.content, "summary": e.summary}
            for e in entries
        ]

    # Get asset URLs
    assets = asset_repo.list_all()
    asset_manifest = {}
    for asset in assets:
        if asset.visibility == "public":
            try:
                url = asset_storage.presigned_url(asset.path)
                asset_manifest[asset.path] = url
            except Exception:
                pass

    return Response({"content": content_data, "assets": asset_manifest})

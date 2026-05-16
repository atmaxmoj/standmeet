from django.urls import path

from interfaces.api.asset_views import asset_detail, asset_list
from interfaces.api.chat_log_views import chat_log_detail, chat_log_list, chat_session_summary_view
from interfaces.api.content_views import content_detail, content_list
from interfaces.api.internal_views import (
    internal_chat_log_view,
    invite_page_view,
    session_init_view,
    session_restore_view,
    session_save_view,
)
from interfaces.api.invite_views import invite_detail, invite_list
from interfaces.api.marketplace_views import (
    marketplace_check_updates,
    marketplace_detail,
    marketplace_install,
    marketplace_search,
)
from interfaces.api.mcp_server_views import mcp_server_detail, mcp_server_list
from interfaces.api.package_views import package_detail, package_list
from interfaces.api.page_views import page_activate, page_build, page_build_log, page_detail, page_dev_data, page_list
from interfaces.api.role_views import role_detail, role_list
from interfaces.api.settings_views import settings_view, status_view
from interfaces.api.skill_views import (
    skill_detail,
    skill_export,
    skill_import,
    skill_import_url,
    skill_import_zip,
    skill_list,
)
from interfaces.api.storage_views import storage_usage_view

urlpatterns = [
    # Assets
    path("assets/", asset_list, name="asset-list"),
    path("assets/<path:path>/", asset_detail, name="asset-detail"),
    # Content (repo)
    path("repo/", content_list, name="content-list"),
    path("repo/<path:path>/", content_detail, name="content-detail"),
    # Roles
    path("roles/", role_list, name="role-list"),
    path("roles/<uuid:role_id>/", role_detail, name="role-detail"),
    # MCP Servers
    path("mcp-servers/", mcp_server_list, name="mcp-server-list"),
    path("mcp-servers/<uuid:server_id>/", mcp_server_detail, name="mcp-server-detail"),
    # Skills
    path("skills/", skill_list, name="skill-list"),
    path("skills/import/", skill_import, name="skill-import"),
    path("skills/import-zip/", skill_import_zip, name="skill-import-zip"),
    path("skills/import-url/", skill_import_url, name="skill-import-url"),
    path("skills/<uuid:skill_id>/", skill_detail, name="skill-detail"),
    path("skills/<uuid:skill_id>/export/", skill_export, name="skill-export"),
    # Marketplace
    path("marketplace/search/", marketplace_search, name="marketplace-search"),
    path("marketplace/install/", marketplace_install, name="marketplace-install"),
    path("marketplace/check-updates/", marketplace_check_updates, name="marketplace-check-updates"),
    path("marketplace/<str:marketplace>/<str:skill_id>/", marketplace_detail, name="marketplace-detail"),
    # Global packages
    path("packages/", package_list, name="package-list"),
    path("packages/<path:name>/", package_detail, name="package-detail"),
    # Pages
    path("pages/", page_list, name="page-list"),
    path("pages/<uuid:page_id>/", page_detail, name="page-detail"),
    path("pages/<uuid:page_id>/build/", page_build, name="page-build"),
    path("pages/<uuid:page_id>/build-log/", page_build_log, name="page-build-log"),
    path("pages/<uuid:page_id>/activate/", page_activate, name="page-activate"),
    # Dev-only endpoint (returns content data for active page)
    path("dev/page-data/", page_dev_data, name="page-dev-data"),
    # Storage
    path("storage/usage/", storage_usage_view, name="storage-usage"),
    # Invites
    path("invites/", invite_list, name="invite-list"),
    path("invites/<str:code>/", invite_detail, name="invite-detail"),
    # Chat logs (per invite)
    path("invites/<str:code>/chats/", chat_log_list, name="chat-log-list"),
    path("invites/<str:code>/chats/<uuid:log_id>/", chat_log_detail, name="chat-log-detail"),
    path("invites/<str:code>/chats/summary/<str:session_id>/", chat_session_summary_view, name="chat-session-summary"),
    # Settings
    path("settings/", settings_view, name="settings"),
    path("status/", status_view, name="status"),
    # Internal (gateway + web)
    path("internal/session-init/", session_init_view, name="session-init"),
    path("internal/invite-page/<str:code>/", invite_page_view, name="invite-page"),
    path("internal/chat-log/", internal_chat_log_view, name="internal-chat-log"),
    path("internal/session/", session_save_view, name="session-save"),
    path("internal/session/<str:session_id>/", session_restore_view, name="session-restore"),
]

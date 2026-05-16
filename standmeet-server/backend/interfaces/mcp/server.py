from __future__ import annotations

import json
import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "standmeet.settings")
django.setup()

from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.server import AuthSettings

from infrastructure.packages.npm_package_manager import NpmPackageManager
from infrastructure.persistence.asset_repo_impl import DjangoAssetRepository
from infrastructure.persistence.content_repo_impl import DjangoContentRepository
from infrastructure.storage.s3_client import MinioAssetStorage
from interfaces.mcp.oauth import InMemoryOAuthProvider

MCP_BASE_URL = os.environ.get("MCP_BASE_URL", "http://localhost:8000/mcp")

oauth_provider = InMemoryOAuthProvider()

mcp = FastMCP(
    "StandMeet",
    streamable_http_path="/",
    auth_server_provider=oauth_provider,
    auth=AuthSettings(
        issuer_url=MCP_BASE_URL,
        resource_server_url=MCP_BASE_URL,
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=["mcp"],
            default_scopes=["mcp"],
        ),
        revocation_options=RevocationOptions(enabled=True),
        required_scopes=["mcp"],
    ),
)

_content_repo = DjangoContentRepository()
_asset_repo = DjangoAssetRepository()
_asset_storage = MinioAssetStorage()
_package_manager = NpmPackageManager()


@mcp.tool()
def list_content(prefix: str = "") -> str:
    """List available content paths with summaries.

    Args:
        prefix: Filter by path prefix (e.g. "/profile")
    """
    entries = _content_repo.list_public(prefix)
    if not entries:
        return "No content found."
    lines = [f"- {e.path}: {e.summary or '(no summary)'}" for e in entries]
    return "\n".join(lines)


@mcp.tool()
def read_content(path: str) -> str:
    """Read content at a specific path.

    Args:
        path: Content path to read (e.g. "/profile/basic-info")
    """
    entry = _content_repo.get_public_by_path(path)
    if entry is None:
        return f"Content not found: {path}"
    return json.dumps(entry.content, ensure_ascii=False, indent=2)


@mcp.tool()
def search_content(query: str) -> str:
    """Search content by keyword.

    Args:
        query: Search query
    """
    entries = _content_repo.list_public("")
    query_lower = query.lower()
    results = []
    for entry in entries:
        searchable = f"{entry.path} {entry.summary} {json.dumps(entry.content)}".lower()
        if query_lower in searchable:
            results.append(f"- {entry.path}: {entry.summary or '(no summary)'}")

    if not results:
        return f"No results found for '{query}'."
    return "\n".join(results)


@mcp.tool()
def list_assets(prefix: str = "") -> str:
    """List available public assets (files).

    Args:
        prefix: Filter by path prefix (e.g. "/photos")
    """
    assets = _asset_repo.list_public(prefix)
    if not assets:
        return "No assets found."
    lines = [f"- {a.path} ({a.filename}, {a.mime_type}, {a.size} bytes)" for a in assets]
    return "\n".join(lines)


@mcp.tool()
def list_packages() -> str:
    """List globally installed npm packages available for page builds."""
    packages = _package_manager.list_installed()
    if not packages:
        return "No packages installed."
    lines = [f"- {p.name}@{p.version}" for p in packages]
    return "\n".join(lines)


@mcp.tool()
def get_asset_url(path: str) -> str:
    """Get a download URL for a public asset.

    Args:
        path: Asset path (e.g. "/photos/avatar.jpg")
    """
    asset = _asset_repo.get_by_path(path)
    if asset is None or asset.visibility != "public":
        return f"Asset not found or not public: {path}"
    url = _asset_storage.presigned_url(path)
    return f"{asset.filename} ({asset.mime_type}): {url}"

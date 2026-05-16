"""Internal API endpoints for gateway communication."""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from application.invite_service import InviteService
from application.mcp_server_service import McpServerService
from application.role_service import RoleService
from application.skill_service import SkillService
from domain.iam.exceptions import InviteExpired
from infrastructure.persistence.invite_repo_impl import DjangoInviteRepository
from infrastructure.persistence.mcp_server_repo_impl import DjangoMcpServerRepository
from infrastructure.persistence.models import ChatLogModel, GatewaySessionModel, InviteCodeModel
from infrastructure.persistence.role_repo_impl import DjangoRoleRepository
from infrastructure.persistence.skill_repo_impl import DjangoSkillRepository
from infrastructure.settings.repo_impl import DjangoSettingsRepository


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def session_init_view(request):
    """Initialize a gateway session for an invite code.

    Returns invite info, role, permissions, and prompts for the gateway
    to build a Claude session.
    """
    invite_code = request.data.get("invite_code")
    preview = request.data.get("preview", False)
    if not invite_code:
        return Response({"error": "invite_code is required"}, status=400)

    invite_repo = DjangoInviteRepository()
    role_repo = DjangoRoleRepository()
    mcp_server_repo = DjangoMcpServerRepository()
    skill_repo = DjangoSkillRepository()
    settings_repo = DjangoSettingsRepository()

    invite_service = InviteService(invite_repo)
    mcp_server_service = McpServerService(mcp_server_repo)
    skill_service = SkillService(skill_repo)

    try:
        invite = invite_service.get(invite_code)
    except InviteExpired:
        return Response({
            "invite": {"code": invite_code, "label": "", "is_valid": False},
            "role": None,
            "global_prompt": "",
            "invite_prompt": "",
            "mcp_servers": [],
            "skills": [],
        })

    # Get role and permissions
    role_data = None
    if invite.role_id:
        role_service = RoleService(role_repo)
        role = role_service.get(invite.role_id)
        if role:
            role_data = {
                "name": role.name,
                "prompt": role.prompt,
                "permissions": [
                    {
                        "action": p.action,
                        "path_pattern": p.path_pattern,
                        "order": p.order,
                    }
                    for p in role.permissions
                ],
            }

    # Get global prompt
    settings = settings_repo.get()

    is_valid = invite.is_valid()

    # Gather custom MCP servers attached to this invite
    mcp_servers_data = []
    for server_id in invite.mcp_server_ids:
        server = mcp_server_service.get(server_id)
        if server:
            mcp_servers_data.append({
                "name": server.name,
                "config": server.config,
            })

    # Gather skills attached to this invite
    skills_data = []
    for skill_id in invite.skill_ids:
        skill = skill_service.get(skill_id)
        if skill:
            skill_entry = {
                "name": skill.name,
                "description": skill.description,
                "prompt": skill.prompt,
            }
            if skill.scripts:
                skill_entry["scripts"] = [
                    {
                        "filename": s.filename,
                        "language": s.language,
                        "content": s.content,
                        "description": s.description,
                        "parameters": s.parameters,
                    }
                    for s in skill.scripts
                ]
            skills_data.append(skill_entry)

    # Record use (increment use_count) for valid invites, skip for previews
    if is_valid and not preview:
        invite_service.record_use(invite_code)

    return Response({
        "invite": {
            "code": invite.code,
            "label": invite.label,
            "is_valid": is_valid,
            "max_messages_per_session": invite.max_messages_per_session,
            "greeting": invite.greeting,
            "page_id": str(invite.page_id) if invite.page_id else None,
        },
        "role": role_data,
        "global_prompt": settings.ai_system_prompt,
        "invite_prompt": invite.prompt,
        "mcp_servers": mcp_servers_data,
        "skills": skills_data,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def internal_chat_log_view(request):
    """Log a chat message from the gateway."""
    invite_code = request.data.get("invite_code")
    user_message = request.data.get("user_message")
    assistant_message = request.data.get("assistant_message")
    session_id = request.data.get("session_id", "")
    sources = request.data.get("sources", [])

    if not invite_code or not assistant_message:
        return Response(
            {"error": "invite_code and assistant_message are required"},
            status=400,
        )

    try:
        invite_model = InviteCodeModel.objects.get(code=invite_code)
    except InviteCodeModel.DoesNotExist:
        return Response({"error": "Invite not found"}, status=404)

    ChatLogModel.objects.create(
        invite=invite_model,
        user_message=user_message or "",
        assistant_message=assistant_message,
        session_id=session_id,
        sources=sources if isinstance(sources, list) else [],
    )

    return Response({"status": "ok"}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def session_save_view(request):
    """Save or update a gateway session mapping."""
    session_id = request.data.get("session_id")
    invite_code = request.data.get("invite_code")
    sdk_session_id = request.data.get("sdk_session_id", "")

    if not session_id or not invite_code:
        return Response(
            {"error": "session_id and invite_code are required"}, status=400
        )

    try:
        invite_model = InviteCodeModel.objects.get(code=invite_code)
    except InviteCodeModel.DoesNotExist:
        return Response({"error": "Invite not found"}, status=404)

    GatewaySessionModel.objects.update_or_create(
        session_id=session_id,
        defaults={
            "invite": invite_model,
            "sdk_session_id": sdk_session_id,
        },
    )

    return Response({"status": "ok"}, status=200)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def session_restore_view(request, session_id):
    """Restore a gateway session from the database.

    Returns invite_code, sdk_session_id, and chat history.
    """
    try:
        gw_session = GatewaySessionModel.objects.select_related("invite").get(
            session_id=session_id
        )
    except GatewaySessionModel.DoesNotExist:
        return Response({"error": "Session not found"}, status=404)

    invite_code = gw_session.invite.code

    # Build history from chat logs for this session
    logs = (
        ChatLogModel.objects.filter(session_id=session_id)
        .order_by("created_at")
    )
    history = []
    for log in logs:
        if log.user_message:
            history.append({"role": "user", "content": log.user_message})
        assistant_entry = {"role": "assistant", "content": log.assistant_message}
        if log.sources:
            assistant_entry["sources"] = log.sources
        history.append(assistant_entry)

    return Response({
        "invite_code": invite_code,
        "sdk_session_id": gw_session.sdk_session_id,
        "history": history,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invite_page_view(request, code):
    """Check if an invite has an associated page.

    Used by the web middleware to decide whether to serve a page or the chat UI.
    """
    try:
        model = InviteCodeModel.objects.get(code=code)
    except InviteCodeModel.DoesNotExist:
        return Response({"page_id": None})

    if not model.page_id:
        return Response({"page_id": None})

    from infrastructure.persistence.models import PageModel
    try:
        page = PageModel.objects.get(id=model.page_id)
        if page.status != "ready":
            return Response({"page_id": None})
        return Response({"page_id": str(page.id)})
    except PageModel.DoesNotExist:
        return Response({"page_id": None})

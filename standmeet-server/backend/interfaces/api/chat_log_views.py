from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from infrastructure.persistence.models import ChatLogModel, ChatSessionSummaryModel, InviteCodeModel


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
def chat_log_list(request, code):
    try:
        invite = InviteCodeModel.objects.get(code=code)
    except InviteCodeModel.DoesNotExist:
        return Response({"error": "Invite not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        logs = ChatLogModel.objects.filter(invite=invite)
        data = [
            {
                "id": str(log.id),
                "session_id": log.session_id or "",
                "user_message": log.user_message,
                "assistant_message": log.assistant_message,
                "sources": log.sources or [],
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]

        # Include per-session summaries
        summaries_qs = ChatSessionSummaryModel.objects.filter(invite=invite)
        summaries = {s.session_id: s.summary for s in summaries_qs}

        return Response({"logs": data, "summaries": summaries})

    # DELETE — clear all (logs + summaries)
    ChatLogModel.objects.filter(invite=invite).delete()
    ChatSessionSummaryModel.objects.filter(invite=invite).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def chat_log_detail(request, code, log_id):
    try:
        invite = InviteCodeModel.objects.get(code=code)
    except InviteCodeModel.DoesNotExist:
        return Response({"error": "Invite not found"}, status=status.HTTP_404_NOT_FOUND)

    deleted, _ = ChatLogModel.objects.filter(id=log_id, invite=invite).delete()
    if not deleted:
        return Response({"error": "Chat log not found"}, status=status.HTTP_404_NOT_FOUND)

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["PUT"])
@permission_classes([IsAuthenticated])
def chat_session_summary_view(request, code, session_id):
    """Save or update a session summary."""
    try:
        invite = InviteCodeModel.objects.get(code=code)
    except InviteCodeModel.DoesNotExist:
        return Response({"error": "Invite not found"}, status=status.HTTP_404_NOT_FOUND)

    summary = request.data.get("summary")
    if not summary:
        return Response({"error": "summary is required"}, status=status.HTTP_400_BAD_REQUEST)

    ChatSessionSummaryModel.objects.update_or_create(
        invite=invite,
        session_id=session_id,
        defaults={"summary": summary},
    )
    return Response({"status": "ok"})

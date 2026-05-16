from rest_framework import serializers


class PathPermissionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["allow", "deny"])
    path_pattern = serializers.CharField(max_length=500)
    order = serializers.IntegerField(required=False, default=0)


class InviteCodeSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    code = serializers.CharField(read_only=True)
    label = serializers.CharField(max_length=255)
    is_active = serializers.BooleanField(read_only=True)
    max_uses = serializers.IntegerField(required=False, allow_null=True, default=None)
    max_messages_per_session = serializers.IntegerField(required=False, allow_null=True, default=None)
    use_count = serializers.IntegerField(read_only=True)
    expires_at = serializers.DateTimeField(read_only=True)
    expires_in_hours = serializers.IntegerField(required=False, write_only=True, allow_null=True)
    role_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    prompt = serializers.CharField(required=False, allow_blank=True, default="")
    greeting = serializers.CharField(required=False, allow_blank=True, default="")
    mcp_server_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=[]
    )
    skill_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=[]
    )
    page_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    created_at = serializers.DateTimeField(read_only=True)


class InviteUpdateSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=255, required=False)
    is_active = serializers.BooleanField(required=False)
    role_id = serializers.UUIDField(required=False, allow_null=True)
    prompt = serializers.CharField(required=False, allow_blank=True)
    greeting = serializers.CharField(required=False, allow_blank=True)
    max_uses = serializers.IntegerField(required=False, allow_null=True)
    max_messages_per_session = serializers.IntegerField(required=False, allow_null=True)
    mcp_server_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False
    )
    skill_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False
    )
    page_id = serializers.UUIDField(required=False, allow_null=True)

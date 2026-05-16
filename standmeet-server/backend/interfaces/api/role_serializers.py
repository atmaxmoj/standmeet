from rest_framework import serializers

from interfaces.api.invite_serializers import PathPermissionSerializer


class RoleSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(max_length=255)
    permissions = PathPermissionSerializer(many=True, required=False, default=[])
    prompt = serializers.CharField(required=False, default="", allow_blank=True)
    created_at = serializers.DateTimeField(read_only=True)


class RoleUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    permissions = PathPermissionSerializer(many=True, required=False)
    prompt = serializers.CharField(required=False, allow_blank=True)

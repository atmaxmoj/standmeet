from rest_framework import serializers


class McpServerSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(max_length=255)
    config = serializers.JSONField(required=False, default=dict)
    created_at = serializers.DateTimeField(read_only=True)


class McpServerUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    config = serializers.JSONField(required=False)

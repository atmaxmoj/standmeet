from rest_framework import serializers


class ContentEntrySerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    path = serializers.CharField(max_length=500)
    content = serializers.JSONField()
    summary = serializers.CharField(required=False, allow_blank=True, default="")
    content_type = serializers.CharField(required=False, default="application/json")
    visibility = serializers.ChoiceField(choices=["private", "public"], required=False, default="private")
    show_as_source = serializers.BooleanField(required=False, default=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class ContentListSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    path = serializers.CharField()
    summary = serializers.CharField()
    content_type = serializers.CharField()
    visibility = serializers.CharField()
    show_as_source = serializers.BooleanField()
    updated_at = serializers.DateTimeField()

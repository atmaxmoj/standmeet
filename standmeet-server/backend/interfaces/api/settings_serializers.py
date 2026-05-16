from rest_framework import serializers


class SiteSettingsSerializer(serializers.Serializer):
    public_access = serializers.BooleanField(required=False)
    ai_system_prompt = serializers.CharField(required=False, allow_blank=True)
    im_integrations = serializers.DictField(required=False, default=dict)


class StatusSerializer(serializers.Serializer):
    version = serializers.CharField()
    content_count = serializers.IntegerField()
    active_invites = serializers.IntegerField()
    public_access = serializers.BooleanField()

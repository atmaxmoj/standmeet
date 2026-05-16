from rest_framework import serializers


class SkillScriptSerializer(serializers.Serializer):
    filename = serializers.CharField(read_only=True)
    language = serializers.CharField(read_only=True)
    content = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    parameters = serializers.ListField(read_only=True)


class SkillSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    prompt = serializers.CharField(required=False, allow_blank=True, default="")
    is_builtin = serializers.BooleanField(read_only=True)
    skill_md_raw = serializers.CharField(read_only=True)
    source = serializers.CharField(read_only=True)
    version = serializers.CharField(read_only=True)
    license = serializers.CharField(read_only=True)
    compatibility = serializers.CharField(read_only=True)
    metadata = serializers.DictField(read_only=True)
    allowed_tools = serializers.ListField(child=serializers.CharField(), read_only=True)
    scripts = SkillScriptSerializer(many=True, read_only=True)
    marketplace_id = serializers.CharField(read_only=True)
    marketplace_name = serializers.CharField(read_only=True)
    source_url = serializers.CharField(read_only=True)
    installed_version = serializers.CharField(read_only=True)
    latest_known_version = serializers.CharField(read_only=True)
    last_checked_at = serializers.DateTimeField(read_only=True, allow_null=True)
    created_at = serializers.DateTimeField(read_only=True)


class SkillUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    prompt = serializers.CharField(required=False, allow_blank=True)


class SkillImportSerializer(serializers.Serializer):
    skill_md_raw = serializers.CharField(trim_whitespace=False)

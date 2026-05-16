from rest_framework import serializers


class PageMetaSerializer(serializers.Serializer):
    title = serializers.CharField(required=False, allow_blank=True, default="")
    description = serializers.CharField(required=False, allow_blank=True, default="")
    favicon_asset_path = serializers.CharField(required=False, allow_null=True, default=None)
    og_image_asset_path = serializers.CharField(required=False, allow_null=True, default=None)
    custom_head = serializers.CharField(required=False, allow_blank=True, default="")


class PageSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    status = serializers.CharField(read_only=True)
    source_files = serializers.DictField(required=False, default=dict)
    must_use = serializers.ListField(
        child=serializers.CharField(), required=False, default=[]
    )
    dont_use = serializers.ListField(
        child=serializers.CharField(), required=False, default=[]
    )
    package_constraints = serializers.CharField(required=False, allow_blank=True, default="")
    meta = PageMetaSerializer(required=False, default=dict)
    build_log = serializers.CharField(read_only=True)
    role_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class PageListSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField()
    description = serializers.CharField()
    status = serializers.CharField()
    role_id = serializers.UUIDField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class PageUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    source_files = serializers.DictField(required=False)
    must_use = serializers.ListField(
        child=serializers.CharField(), required=False
    )
    dont_use = serializers.ListField(
        child=serializers.CharField(), required=False
    )
    package_constraints = serializers.CharField(required=False, allow_blank=True)
    meta = PageMetaSerializer(required=False)
    role_id = serializers.UUIDField(required=False, allow_null=True)

from rest_framework import serializers


class AssetSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    path = serializers.CharField(max_length=500)
    filename = serializers.CharField(max_length=255, read_only=True)
    size = serializers.IntegerField(read_only=True)
    mime_type = serializers.CharField(max_length=255, read_only=True)
    visibility = serializers.ChoiceField(choices=["private", "public"], required=False, default="private")
    download_url = serializers.CharField(read_only=True, required=False)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class AssetListSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    path = serializers.CharField()
    filename = serializers.CharField()
    size = serializers.IntegerField()
    mime_type = serializers.CharField()
    visibility = serializers.CharField()
    updated_at = serializers.DateTimeField()


class AssetVisibilitySerializer(serializers.Serializer):
    visibility = serializers.ChoiceField(choices=["private", "public"])

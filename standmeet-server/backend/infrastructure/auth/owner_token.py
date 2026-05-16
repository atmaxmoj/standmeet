import secrets
import uuid

from django.db import models
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


class OwnerToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=100, unique=True, db_index=True)
    label = models.CharField(max_length=255, default="default")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "standmeet_auth"
        db_table = "owner_tokens"

    def __str__(self):
        return f"OwnerToken({self.label})"

    @classmethod
    def generate(cls, label: str = "default") -> "OwnerToken":
        token = f"smo_{secrets.token_urlsafe(32)}"
        return cls.objects.create(token=token, label=label)


class OwnerUser:
    """Lightweight user object for DRF authentication — represents the owner."""

    is_authenticated = True
    is_active = True
    is_staff = False

    def __init__(self, token_obj: OwnerToken):
        self.token_obj = token_obj

    def __str__(self):
        return f"Owner({self.token_obj.label})"


class OwnerTokenAuthentication(BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith(f"{self.keyword} "):
            return None

        token = auth_header[len(self.keyword) + 1 :]
        if not token.startswith("smo_"):
            return None

        try:
            token_obj = OwnerToken.objects.get(token=token, is_active=True)
        except OwnerToken.DoesNotExist:
            raise AuthenticationFailed("Invalid owner token")

        return (OwnerUser(token_obj), token_obj)

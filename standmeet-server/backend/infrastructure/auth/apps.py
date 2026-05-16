from django.apps import AppConfig


class StandmeetAuthConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "infrastructure.auth"
    label = "standmeet_auth"
    verbose_name = "StandMeet Auth"

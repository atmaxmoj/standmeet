from django.apps import AppConfig


class SettingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "infrastructure.settings"
    label = "standmeet_settings"
    verbose_name = "StandMeet Settings"

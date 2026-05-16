from django.db import models


class SiteSettingsModel(models.Model):
    """Singleton settings model — only one row should exist."""

    public_access = models.BooleanField(default=False)
    ai_system_prompt = models.TextField(default="", blank=True)
    extra = models.JSONField(default=dict, blank=True)

    class Meta:
        app_label = "standmeet_settings"
        db_table = "site_settings"
        verbose_name = "Site Settings"
        verbose_name_plural = "Site Settings"

    def __str__(self):
        return "Site Settings"

    def save(self, *args, **kwargs):
        # Enforce singleton: always use pk=1
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

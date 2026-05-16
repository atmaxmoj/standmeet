from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0011_add_skill_md_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillmodel",
            name="marketplace_id",
            field=models.CharField(max_length=255, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="marketplace_name",
            field=models.CharField(max_length=100, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="source_url",
            field=models.URLField(max_length=500, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="installed_version",
            field=models.CharField(max_length=50, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="latest_known_version",
            field=models.CharField(max_length=50, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="last_checked_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
    ]

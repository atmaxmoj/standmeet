from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0010_add_skill"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillmodel",
            name="skill_md_raw",
            field=models.TextField(default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="source",
            field=models.CharField(max_length=20, default="manual"),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="version",
            field=models.CharField(max_length=50, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="license",
            field=models.CharField(max_length=100, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="compatibility",
            field=models.CharField(max_length=255, default="", blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="skill_metadata",
            field=models.JSONField(default=dict, blank=True),
        ),
        migrations.AddField(
            model_name="skillmodel",
            name="allowed_tools",
            field=models.JSONField(default=list, blank=True),
        ),
    ]

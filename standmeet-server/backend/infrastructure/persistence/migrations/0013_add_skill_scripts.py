import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0012_add_marketplace_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="SkillScriptModel",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("filename", models.CharField(max_length=255)),
                ("language", models.CharField(max_length=20)),
                ("content", models.TextField()),
                ("description", models.TextField(blank=True, default="")),
                ("parameters", models.JSONField(blank=True, default=list)),
                (
                    "skill",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scripts",
                        to="persistence.skillmodel",
                    ),
                ),
            ],
            options={
                "db_table": "skill_scripts",
                "ordering": ["filename"],
                "unique_together": {("skill", "filename")},
            },
        ),
    ]

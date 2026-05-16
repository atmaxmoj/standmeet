import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0022_add_asset_model"),
    ]

    operations = [
        migrations.CreateModel(
            name="PageModel",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, default="")),
                ("status", models.CharField(db_index=True, default="draft", max_length=20)),
                ("source_files", models.JSONField(blank=True, default=dict)),
                ("packages", models.JSONField(blank=True, default=list)),
                ("package_constraints", models.TextField(blank=True, default="")),
                ("meta", models.JSONField(blank=True, default=dict)),
                ("build_log", models.TextField(blank=True, default="")),
                ("role", models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="pages",
                    to="persistence.rolemodel",
                )),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "pages",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="invitecodemodel",
            name="page",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invites",
                to="persistence.pagemodel",
            ),
        ),
    ]

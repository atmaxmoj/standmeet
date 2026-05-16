import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0021_add_invite_greeting"),
    ]

    operations = [
        migrations.CreateModel(
            name="AssetModel",
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
                ("path", models.CharField(db_index=True, max_length=500, unique=True)),
                ("filename", models.CharField(max_length=255)),
                ("size", models.BigIntegerField()),
                ("mime_type", models.CharField(max_length=255)),
                (
                    "visibility",
                    models.CharField(
                        db_index=True, default="private", max_length=10
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "assets",
                "ordering": ["path"],
            },
        ),
    ]

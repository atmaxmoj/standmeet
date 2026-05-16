import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0014_chatlog_session_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="GatewaySessionModel",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("session_id", models.CharField(db_index=True, max_length=36, unique=True)),
                ("sdk_session_id", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "invite",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="gateway_sessions",
                        to="persistence.invitecodemodel",
                    ),
                ),
            ],
            options={
                "db_table": "gateway_sessions",
            },
        ),
    ]

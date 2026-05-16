# Generated manually

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0002_add_invite_prompt"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatLogModel",
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
                ("user_message", models.TextField()),
                ("assistant_message", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "invite",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_logs",
                        to="persistence.invitecodemodel",
                    ),
                ),
            ],
            options={
                "db_table": "chat_logs",
                "ordering": ["-created_at"],
            },
        ),
    ]

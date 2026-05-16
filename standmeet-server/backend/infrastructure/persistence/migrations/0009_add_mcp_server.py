import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0008_add_max_messages_per_session"),
    ]

    operations = [
        migrations.CreateModel(
            name="McpServerModel",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=255, unique=True)),
                ("config", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "mcp_servers",
                "ordering": ["name"],
            },
        ),
        migrations.AddField(
            model_name="invitecodemodel",
            name="mcp_servers",
            field=models.ManyToManyField(blank=True, related_name="invites", to="persistence.mcpservermodel"),
        ),
    ]

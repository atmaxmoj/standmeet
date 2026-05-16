import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0017_seed_builtin_skills"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatSessionSummaryModel",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("session_id", models.CharField(db_index=True, max_length=36)),
                ("summary", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("invite", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="session_summaries", to="persistence.invitecodemodel")),
            ],
            options={
                "db_table": "chat_session_summaries",
                "unique_together": {("invite", "session_id")},
            },
        ),
    ]

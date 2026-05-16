import uuid

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0009_add_mcp_server"),
    ]

    operations = [
        migrations.CreateModel(
            name="SkillModel",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=255, unique=True)),
                ("description", models.TextField(default="", blank=True)),
                ("prompt", models.TextField(default="", blank=True)),
                ("is_builtin", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "skills",
                "ordering": ["name"],
            },
        ),
        migrations.AddField(
            model_name="invitecodemodel",
            name="skills",
            field=models.ManyToManyField(blank=True, related_name="invites", to="persistence.skillmodel"),
        ),
    ]

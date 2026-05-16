from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0020_update_report_skill_prompt_v2"),
    ]

    operations = [
        migrations.AddField(
            model_name="invitecodemodel",
            name="greeting",
            field=models.TextField(default="", blank=True),
        ),
    ]

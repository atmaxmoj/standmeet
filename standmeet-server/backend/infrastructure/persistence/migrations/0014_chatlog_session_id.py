from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0013_add_skill_scripts"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatlogmodel",
            name="session_id",
            field=models.CharField(blank=True, default="", max_length=36),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0015_gateway_session"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatlogmodel",
            name="sources",
            field=models.JSONField(blank=True, default=list),
        ),
    ]

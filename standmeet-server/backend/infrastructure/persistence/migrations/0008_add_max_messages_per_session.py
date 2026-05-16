from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0007_add_show_as_source"),
    ]

    operations = [
        migrations.AddField(
            model_name="invitecodemodel",
            name="max_messages_per_session",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]

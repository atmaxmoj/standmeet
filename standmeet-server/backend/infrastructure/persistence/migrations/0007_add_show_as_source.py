from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0006_add_content_visibility"),
    ]

    operations = [
        migrations.AddField(
            model_name="contententrymodel",
            name="show_as_source",
            field=models.BooleanField(default=True),
        ),
    ]

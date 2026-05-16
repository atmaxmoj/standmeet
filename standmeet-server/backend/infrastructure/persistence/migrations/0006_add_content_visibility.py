from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0005_add_role_prompt"),
    ]

    operations = [
        migrations.AddField(
            model_name="contententrymodel",
            name="visibility",
            field=models.CharField(
                max_length=10,
                default="private",
                db_index=True,
            ),
        ),
    ]

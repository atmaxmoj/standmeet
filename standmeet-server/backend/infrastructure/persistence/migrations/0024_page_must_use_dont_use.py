from django.db import migrations, models


def migrate_packages_to_must_use(apps, schema_editor):
    PageModel = apps.get_model("persistence", "PageModel")
    for page in PageModel.objects.all():
        if page.packages:
            page.must_use = page.packages
            page.save(update_fields=["must_use"])


class Migration(migrations.Migration):
    dependencies = [
        ("persistence", "0023_add_page_model"),
    ]

    operations = [
        migrations.AddField(
            model_name="pagemodel",
            name="must_use",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="pagemodel",
            name="dont_use",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(migrate_packages_to_must_use, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="pagemodel",
            name="packages",
        ),
    ]

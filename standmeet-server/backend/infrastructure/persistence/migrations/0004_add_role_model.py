"""Add Role model, migrate permissions from InviteCode to Role."""

import uuid

import django.db.models.deletion
from django.db import migrations, models


def migrate_permissions_to_roles(apps, schema_editor):
    """For each invite that has permissions, create a role and move permissions."""
    InviteCodeModel = apps.get_model("persistence", "InviteCodeModel")
    RoleModel = apps.get_model("persistence", "RoleModel")
    PathPermissionModel = apps.get_model("persistence", "PathPermissionModel")

    for invite in InviteCodeModel.objects.all():
        perms = PathPermissionModel.objects.filter(invite=invite)
        if not perms.exists():
            continue
        # Create a role for this invite
        role = RoleModel.objects.create(
            name=f"role_{invite.label}",
        )
        # Move permissions to the role
        perms.update(role=role)
        # Link invite to role
        invite.role = role
        invite.save()

    # Remove leftover invite FK reference (set to null) — the field will be removed next
    PathPermissionModel.objects.filter(invite__isnull=False, role__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("persistence", "0003_add_chat_log"),
    ]

    operations = [
        # 1. Create RoleModel
        migrations.CreateModel(
            name="RoleModel",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=255, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "roles",
                "ordering": ["name"],
            },
        ),
        # 2. Add nullable role FK to PathPermissionModel
        migrations.AddField(
            model_name="pathpermissionmodel",
            name="role",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="permissions",
                to="persistence.rolemodel",
            ),
        ),
        # 3. Add nullable role FK to InviteCodeModel
        migrations.AddField(
            model_name="invitecodemodel",
            name="role",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invites",
                to="persistence.rolemodel",
            ),
        ),
        # 4. Data migration: move permissions from invite → role
        migrations.RunPython(
            migrate_permissions_to_roles,
            migrations.RunPython.noop,
        ),
        # 5. Remove old invite FK from PathPermissionModel
        migrations.RemoveField(
            model_name="pathpermissionmodel",
            name="invite",
        ),
        # 6. Make role FK non-nullable on PathPermissionModel
        migrations.AlterField(
            model_name="pathpermissionmodel",
            name="role",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="permissions",
                to="persistence.rolemodel",
            ),
        ),
    ]

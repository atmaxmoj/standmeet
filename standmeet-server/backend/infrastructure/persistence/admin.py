from django.contrib import admin

from infrastructure.persistence.models import (
    ContentEntryModel,
    InviteCodeModel,
    PathPermissionModel,
    RoleModel,
)


class PathPermissionInline(admin.TabularInline):
    model = PathPermissionModel
    extra = 1


@admin.register(ContentEntryModel)
class ContentEntryAdmin(admin.ModelAdmin):
    list_display = ["path", "content_type", "updated_at"]
    search_fields = ["path", "summary"]


@admin.register(RoleModel)
class RoleAdmin(admin.ModelAdmin):
    list_display = ["name", "created_at"]
    inlines = [PathPermissionInline]


@admin.register(InviteCodeModel)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = ["code", "label", "is_active", "use_count", "role", "expires_at"]
    list_filter = ["is_active"]

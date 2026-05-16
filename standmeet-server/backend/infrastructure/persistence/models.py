import uuid

from django.db import models


class ContentEntryModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    path = models.CharField(max_length=500, unique=True, db_index=True)
    content = models.JSONField(default=dict)
    summary = models.TextField(default="", blank=True)
    content_type = models.CharField(max_length=100, default="application/json")
    visibility = models.CharField(max_length=10, default="private", db_index=True)
    show_as_source = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "persistence"
        db_table = "content_entries"
        ordering = ["path"]

    def __str__(self):
        return self.path


class RoleModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    prompt = models.TextField(default="", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "persistence"
        db_table = "roles"
        ordering = ["name"]

    def __str__(self):
        return self.name


class McpServerModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    config = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "persistence"
        db_table = "mcp_servers"
        ordering = ["name"]

    def __str__(self):
        return self.name


class SkillModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(default="", blank=True)
    prompt = models.TextField(default="", blank=True)
    is_builtin = models.BooleanField(default=False)
    skill_md_raw = models.TextField(default="", blank=True)
    source = models.CharField(max_length=20, default="manual")
    version = models.CharField(max_length=50, default="", blank=True)
    license = models.CharField(max_length=100, default="", blank=True)
    compatibility = models.CharField(max_length=255, default="", blank=True)
    skill_metadata = models.JSONField(default=dict, blank=True)
    allowed_tools = models.JSONField(default=list, blank=True)
    marketplace_id = models.CharField(max_length=255, default="", blank=True)
    marketplace_name = models.CharField(max_length=100, default="", blank=True)
    source_url = models.URLField(max_length=500, default="", blank=True)
    installed_version = models.CharField(max_length=50, default="", blank=True)
    latest_known_version = models.CharField(max_length=50, default="", blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "persistence"
        db_table = "skills"
        ordering = ["name"]

    def __str__(self):
        return self.name


class SkillScriptModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    skill = models.ForeignKey(
        SkillModel,
        on_delete=models.CASCADE,
        related_name="scripts",
    )
    filename = models.CharField(max_length=255)
    language = models.CharField(max_length=20)
    content = models.TextField()
    description = models.TextField(default="", blank=True)
    parameters = models.JSONField(default=list, blank=True)

    class Meta:
        app_label = "persistence"
        db_table = "skill_scripts"
        ordering = ["filename"]
        unique_together = [("skill", "filename")]

    def __str__(self):
        return f"{self.skill.name}/{self.filename}"


class InviteCodeModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=100, unique=True, db_index=True)
    label = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    use_count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    role = models.ForeignKey(
        RoleModel,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invites",
    )
    max_messages_per_session = models.PositiveIntegerField(null=True, blank=True)
    prompt = models.TextField(default="", blank=True)
    greeting = models.TextField(default="", blank=True)
    page = models.ForeignKey(
        "PageModel",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invites",
    )
    mcp_servers = models.ManyToManyField(McpServerModel, blank=True, related_name="invites")
    skills = models.ManyToManyField(SkillModel, blank=True, related_name="invites")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "persistence"
        db_table = "invite_codes"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.label} ({self.code})"


class PathPermissionModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(
        RoleModel,
        on_delete=models.CASCADE,
        related_name="permissions",
    )
    action = models.CharField(max_length=10, choices=[("allow", "Allow"), ("deny", "Deny")])
    path_pattern = models.CharField(max_length=500)
    order = models.IntegerField(default=0)

    class Meta:
        app_label = "persistence"
        db_table = "path_permissions"
        ordering = ["order"]

    def __str__(self):
        return f"{self.action} {self.path_pattern}"


class GatewaySessionModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session_id = models.CharField(max_length=36, unique=True, db_index=True)
    invite = models.ForeignKey(
        InviteCodeModel,
        on_delete=models.CASCADE,
        related_name="gateway_sessions",
    )
    sdk_session_id = models.CharField(max_length=255, default="", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "persistence"
        db_table = "gateway_sessions"

    def __str__(self):
        return f"Session {self.session_id} for {self.invite.label}"


class ChatLogModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invite = models.ForeignKey(
        InviteCodeModel,
        on_delete=models.CASCADE,
        related_name="chat_logs",
    )
    session_id = models.CharField(max_length=36, default="", blank=True)
    user_message = models.TextField()
    assistant_message = models.TextField()
    sources = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "persistence"
        db_table = "chat_logs"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Chat log for {self.invite.label} at {self.created_at}"


class PageModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    description = models.TextField(default="", blank=True)
    status = models.CharField(max_length=20, default="draft", db_index=True)
    source_files = models.JSONField(default=dict, blank=True)
    must_use = models.JSONField(default=list, blank=True)
    dont_use = models.JSONField(default=list, blank=True)
    package_constraints = models.TextField(default="", blank=True)
    meta = models.JSONField(default=dict, blank=True)
    build_log = models.TextField(default="", blank=True)
    role = models.ForeignKey(
        RoleModel,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pages",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "persistence"
        db_table = "pages"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class AssetModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    path = models.CharField(max_length=500, unique=True, db_index=True)
    filename = models.CharField(max_length=255)
    size = models.BigIntegerField()
    mime_type = models.CharField(max_length=255)
    visibility = models.CharField(max_length=10, default="private", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "persistence"
        db_table = "assets"
        ordering = ["path"]

    def __str__(self):
        return self.path


class ChatSessionSummaryModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invite = models.ForeignKey(
        InviteCodeModel,
        on_delete=models.CASCADE,
        related_name="session_summaries",
    )
    session_id = models.CharField(max_length=36, db_index=True)
    summary = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "persistence"
        db_table = "chat_session_summaries"
        unique_together = [("invite", "session_id")]

    def __str__(self):
        return f"Summary for session {self.session_id}"

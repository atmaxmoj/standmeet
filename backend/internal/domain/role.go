// role.go —— owner-scoped visitor 身份原型。设计 [[iam-role-pivot-plan]]。
//
// Role = persona (Prompt) + 可见 corpus URI globs + Skills + MCP servers。一张
// access_code 挂一个 assumed_role_id；session start 时把 role 完整拍下来塞
// session_data（RoleSnapshot），跟 role 解耦 —— owner 改 role 不影响在跑
// session，唯一补救 = revoke code。
//
// public role（is_builtin=true）由 SeedPublicRole 在 owner claim 时种：
// 公开 corpus 三 glob、无 skill、无 mcp、挂 public prompt。不可删（repo 层挡）。
//
// LSP / OCP 备忘：Role 本身就是值对象，没有 sub-type。Corpus ACL 评估走
// AllowsCorpus(uri) 一个 method —— positive-list only，没有 deny / order；
// 唯一 hardcode 是 raw://** 永远 deny visitor。

package domain

import (
	"errors"
	"slices"
	"strings"
	"time"
)

// Role —— roles 行的领域值对象 + 关联的 corpus URIs / skill IDs / mcp server IDs。
type Role struct {
	createdAt    time.Time
	updatedAt    time.Time
	id           string
	ownerID      string
	name         string
	description  string
	greeting     string // 访客名字选择器看到的「这是什么」介绍(空=用默认)
	promptID     string // 空 = 没挂 prompt（public 也是挂的，这里是真的 NULL 的情况）
	corpusURIs   []string
	skillIDs     []string
	mcpServerIDs []string
	// waypoints —— ghost-steering 的引导目的地（owner per-role 写）。session freeze 时随
	// RoleSnapshot 冻结 + 按 corpus glob 过滤（见 FilterWaypointsByCorpus）。
	waypoints []Waypoint
	// dockButtons —— #109/#110 这个 role 的 ≤2 个 chat dock 按钮配置。
	dockButtons []DockButtonConfig
	isBuiltin   bool
	hasPrompt   bool
	// notifyOnBooking —— #130: 这个 role 下约成后给 owner 自己发通知邮件。
	notifyOnBooking bool
}

// RoleInit —— 构造参数。
type RoleInit struct {
	CreatedAt    time.Time
	UpdatedAt    time.Time
	PromptID     *string
	ID           string
	OwnerID      string
	Name         string
	Description  string
	Greeting     string
	CorpusURIs   []string
	SkillIDs     []string
	MCPServerIDs []string
	Waypoints    []Waypoint
	DockButtons  []DockButtonConfig
	IsBuiltin    bool
	// NotifyOwnerOnBooking —— #130 per-role 通知开关。
	NotifyOwnerOnBooking bool
}

// NewRole —— 从 Init 构造。容器字段 defensive clone；nil → 空切片。
func NewRole(i *RoleInit) Role {
	r := Role{
		id:              i.ID,
		ownerID:         i.OwnerID,
		name:            i.Name,
		description:     i.Description,
		greeting:        i.Greeting,
		isBuiltin:       i.IsBuiltin,
		createdAt:       i.CreatedAt,
		updatedAt:       i.UpdatedAt,
		corpusURIs:      cloneStrings(i.CorpusURIs),
		skillIDs:        cloneStrings(i.SkillIDs),
		mcpServerIDs:    cloneStrings(i.MCPServerIDs),
		waypoints:       cloneWaypoints(i.Waypoints),
		dockButtons:     cloneDockButtons(i.DockButtons),
		notifyOnBooking: i.NotifyOwnerOnBooking,
	}
	if i.PromptID != nil {
		r.promptID = *i.PromptID
		r.hasPrompt = true
	}
	return r
}

func cloneStrings(s []string) []string {
	if len(s) == 0 {
		return []string{}
	}
	return slices.Clone(s)
}

// ID —— DB primary key。
func (r *Role) ID() string { return r.id }

// OwnerID —— owner-scoped FK。
func (r *Role) OwnerID() string { return r.ownerID }

// Name —— role slug（owner 内唯一）。
func (r *Role) Name() string { return r.name }

// Description —— 一句简介(admin 内部用)。
func (r *Role) Description() string { return r.description }

// Greeting —— 访客名字选择器看到的「这是什么」介绍(per-role,owner 可改)。
func (r *Role) Greeting() string { return r.greeting }

// PromptID —— 挂的 prompt 的 ID，第二返表是否设了。SET NULL on prompt delete
// 时 hasPrompt = false。
func (r *Role) PromptID() (string, bool) {
	if !r.hasPrompt {
		return "", false
	}
	return r.promptID, true
}

// HasPrompt —— 是否挂了 prompt。
func (r *Role) HasPrompt() bool { return r.hasPrompt }

// CorpusURIs —— 可见 corpus URI glob 列表（defensive copy）。
func (r *Role) CorpusURIs() []string { return slices.Clone(r.corpusURIs) }

// SkillIDs —— 解锁的 skill id 列表（defensive copy）。
func (r *Role) SkillIDs() []string { return slices.Clone(r.skillIDs) }

// MCPServerIDs —— 解锁的 MCP server id 列表（defensive copy）。
func (r *Role) MCPServerIDs() []string { return slices.Clone(r.mcpServerIDs) }

// DockButtons —— 这个 role 的 ≤2 个 chat dock 按钮配置（defensive copy）。
func (r *Role) DockButtons() []DockButtonConfig { return cloneDockButtons(r.dockButtons) }

// Waypoints —— ghost-steering 引导目的地（defensive copy）。freeze 时经
// FilterWaypointsByCorpus 过滤后进 RoleSnapshot。
func (r *Role) Waypoints() []Waypoint { return cloneWaypoints(r.waypoints) }

// IsBuiltin —— 是否种入的 builtin（public 是 true）。
func (r *Role) IsBuiltin() bool { return r.isBuiltin }

// NotifyOwnerOnBooking —— #130: 约成后是否给 owner 自己发通知邮件。
func (r *Role) NotifyOwnerOnBooking() bool { return r.notifyOnBooking }

// CreatedAt —— 创建时间。
func (r *Role) CreatedAt() time.Time { return r.createdAt }

// UpdatedAt —— 最后更新时间。
func (r *Role) UpdatedAt() time.Time { return r.updatedAt }

// HasSkill —— role 是否挂了某 skill。
func (r *Role) HasSkill(skillID string) bool {
	return slices.Contains(r.skillIDs, skillID)
}

// HasMCPServer —— role 是否挂了某 MCP server。
func (r *Role) HasMCPServer(mcpServerID string) bool {
	return slices.Contains(r.mcpServerIDs, mcpServerID)
}

// AllowsCorpus —— 评估 URI 准入。raw://** hardcode deny；其他走 positive-list
// glob 匹配。corpus_uris 空 = deny 全部。
//
// 跟 [[role_snapshot]].AllowsCorpus 同语义；snapshot 是 session 起 freeze
// 那一刻的拷贝，本 method 是 owner-facing 实时检查（admin 调试时用）。
// 同 glob 引擎（[[path_acl]] 的 compileGlob）。
func (r *Role) AllowsCorpus(uri string) bool {
	if strings.HasPrefix(uri, "raw://") {
		return false
	}
	for _, pattern := range r.corpusURIs {
		if compileGlob(pattern).MatchString(uri) {
			return true
		}
	}
	return false
}

// PublicRoleName —— builtin public role 的 name（曾叫 "vanilla"，名字太随意、不自我说明，
// 重命名为 "public"）。SeedPublicRole 用。
//
// 为什么叫 "public":每张 access code 是**定向邀请**，冻结一个 owner 指定的 role。而 BYOAI
// 访客（自带 API key、没被邀请、走 /gate 的默认档）不属于任何邀请 → 落到这个**默认、公开**的
// role。所以「未被邀请的默认访客 = public」。visitor_public.go 的 public/byoai 路径锁定它，
// jobsuc 自动发的 application code 也默认挂它。它是 is_builtin=true：不可删、name 不可改，
// 但 owner **可以改它的 prompt / corpus**（收窄公开面）。
//
// 注意跟 writings.visibility='public'（[[VisibilityPublic]]）区分：那是**内容**可见性
// (public/private)，这是**访客身份** role 的 name。二者不同表不同列，语义上对齐
// (public 身份读 public 内容) 但不是同一实体。
const PublicRoleName = "public"

// PublicRoleDescription —— public role 的一句简介。
const PublicRoleDescription = "System default. Public corpus, no skills, no MCP. " +
	"For uninvited BYOAI visitors (access codes are directed invites; this is the fallback)."

// PublicRoleCorpusURIs —— public 的"公开"corpus 范围。匹配设计稿
// admin-data.js ROLES[0].corpus_uris。
var PublicRoleCorpusURIs = []string{
	"wiki://**",
	"output://**",
	"writing://**",
}

// ErrRoleNotFound —— role id 不存在或不属于该 owner。
var ErrRoleNotFound = errors.New("role not found")

// ErrRoleNameTaken —— 同 owner 下 name 重复（unique constraint）。
var ErrRoleNameTaken = errors.New("role name already taken in this owner")

// ErrRoleBuiltinImmutable —— 试图删除或改名 builtin role（public）。
var ErrRoleBuiltinImmutable = errors.New("builtin role cannot be deleted or renamed")

// role.go —— owner-scoped visitor 身份原型。设计 [[iam-role-pivot-plan]]。
//
// Role = persona (Prompt) + 可见 corpus URI globs + Skills + MCP servers。一张
// access_code 挂一个 assumed_role_id；session start 时把 role 完整拍下来塞
// session_data（RoleSnapshot），跟 role 解耦 —— owner 改 role 不影响在跑
// session，唯一补救 = revoke code。
//
// vanilla role（is_builtin=true）由 SeedVanillaRole 在 owner claim 时种：
// 公开 corpus 三 glob、无 skill、无 mcp、挂 vanilla prompt。不可删（repo 层挡）。
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
	promptID     string // 空 = 没挂 prompt（vanilla 也是挂的，这里是真的 NULL 的情况）
	corpusURIs   []string
	skillIDs     []string
	mcpServerIDs []string
	isBuiltin    bool
	hasPrompt    bool
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
	IsBuiltin    bool
}

// NewRole —— 从 Init 构造。容器字段 defensive clone；nil → 空切片。
func NewRole(i *RoleInit) Role {
	r := Role{
		id:           i.ID,
		ownerID:      i.OwnerID,
		name:         i.Name,
		description:  i.Description,
		greeting:     i.Greeting,
		isBuiltin:    i.IsBuiltin,
		createdAt:    i.CreatedAt,
		updatedAt:    i.UpdatedAt,
		corpusURIs:   cloneStrings(i.CorpusURIs),
		skillIDs:     cloneStrings(i.SkillIDs),
		mcpServerIDs: cloneStrings(i.MCPServerIDs),
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

// IsBuiltin —— 是否种入的 builtin（vanilla 是 true）。
func (r *Role) IsBuiltin() bool { return r.isBuiltin }

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

// VanillaRoleName —— builtin vanilla role 的 name。SeedVanillaRole 用。
const VanillaRoleName = "vanilla"

// VanillaRoleDescription —— vanilla role 的一句简介。
const VanillaRoleDescription = "System default. Public corpus, no skills, no MCP. " +
	"Used when no other role is assigned."

// VanillaRoleCorpusURIs —— vanilla 的"公开"corpus 范围。匹配设计稿
// admin-data.js ROLES[0].corpus_uris。
var VanillaRoleCorpusURIs = []string{
	"wiki://**",
	"output://**",
	"writing://**",
}

// ErrRoleNotFound —— role id 不存在或不属于该 owner。
var ErrRoleNotFound = errors.New("role not found")

// ErrRoleNameTaken —— 同 owner 下 name 重复（unique constraint）。
var ErrRoleNameTaken = errors.New("role name already taken in this owner")

// ErrRoleBuiltinImmutable —— 试图删除或改名 builtin role（vanilla）。
var ErrRoleBuiltinImmutable = errors.New("builtin role cannot be deleted or renamed")

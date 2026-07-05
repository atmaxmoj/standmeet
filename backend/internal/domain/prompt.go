// prompt.go —— owner-scoped persona/instruction 片段库。设计 [[iam-role-pivot-plan]]。
//
// 通用 type：挂 role 后语义角色叫"role prompt"，但 type 本身不带这个限定。
// public（is_builtin=true）由 SeedPublicRole 在 owner claim 时种入；删除被
// repo 层挡（ErrPromptBuiltinImmutable）。

package domain

import (
	"errors"
	"time"
)

// Prompt —— prompts 行的领域值对象。
//
// 字段顺序按 govet fieldalignment：time 在前、string 后、bool 末尾。
type Prompt struct {
	createdAt   time.Time
	updatedAt   time.Time
	id          string
	ownerID     string
	name        string
	body        string
	description string
	isBuiltin   bool
}

// PromptInit —— 构造参数。
type PromptInit struct {
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ID          string
	OwnerID     string
	Name        string
	Body        string
	Description string
	IsBuiltin   bool
}

// NewPrompt —— 从 Init 构造。pointer 入参避开 hugeParam。
func NewPrompt(i *PromptInit) Prompt {
	return Prompt{
		id:          i.ID,
		ownerID:     i.OwnerID,
		name:        i.Name,
		body:        i.Body,
		description: i.Description,
		isBuiltin:   i.IsBuiltin,
		createdAt:   i.CreatedAt,
		updatedAt:   i.UpdatedAt,
	}
}

// ID —— DB primary key。
func (p *Prompt) ID() string { return p.id }

// OwnerID —— owner-scoped FK。
func (p *Prompt) OwnerID() string { return p.ownerID }

// Name —— prompt slug（owner 内唯一）。
func (p *Prompt) Name() string { return p.name }

// Body —— system prompt 片段全文。
func (p *Prompt) Body() string { return p.body }

// Description —— 一句简介。
func (p *Prompt) Description() string { return p.description }

// IsBuiltin —— 是否种入的 builtin（true = 不可删 / 不可改 name）。
func (p *Prompt) IsBuiltin() bool { return p.isBuiltin }

// CreatedAt —— 创建时间。
func (p *Prompt) CreatedAt() time.Time { return p.createdAt }

// UpdatedAt —— 最后更新时间。
func (p *Prompt) UpdatedAt() time.Time { return p.updatedAt }

// PublicPromptName —— builtin public prompt 的 name。SeedPublicRole 用。
const PublicPromptName = "public"

// PublicPromptBody —— public prompt 的 system prompt 文案。设计稿
// docs/design/project/admin-data.js PROMPTS[0]。owner 可改。
const PublicPromptBody = "You are an AI proxy for {owner}. " +
	"Answer questions accurately from the visible corpus. " +
	"If you do not know, say so plainly."

// PublicPromptDescription —— public prompt 的一句简介。
const PublicPromptDescription = "Plain helpful proxy. No persona overlay."

// ErrPromptNotFound —— prompt id 不存在或不属于该 owner。
var ErrPromptNotFound = errors.New("prompt not found")

// ErrPromptNameTaken —— 同 owner 下 name 重复（unique constraint）。
var ErrPromptNameTaken = errors.New("prompt name already taken in this owner")

// ErrPromptBuiltinImmutable —— 试图删除或改名 builtin prompt。
var ErrPromptBuiltinImmutable = errors.New("builtin prompt cannot be deleted or renamed")

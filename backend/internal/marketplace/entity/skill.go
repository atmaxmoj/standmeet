// skill.go —— owner-curated AI persona/能力包。设计源自 legacy
// standmeet-server/backend/domain/iam/entities.py:Skill +
// gateway/src/runtime/skill-tools.ts。
//
// 每个 Skill = 一段附加 system prompt + 可选 sandbox 脚本。InviteCode
// 引用一组 skill_ids；visitor session 拼 base persona + 选中 skill.prompt[]。
// builtin skills (Code Review / Conversation Report …) seed 时插，不可删。

package entity

import (
	"errors"
	"time"
)

// Skill —— skills 行的值对象。字段顺序按 govet fieldalignment 排：先 map
// (8B header+pad)、time、string、slice、bool 收尾。
type Skill struct {
	Metadata     map[string]string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	ID           string
	OwnerID      string
	Name         string
	Description  string
	Prompt       string
	Version      string
	License      string
	Source       string // 'manual' | 'builtin' | 'import' | 'marketplace'
	AllowedTools []string
	Scripts      []SkillScript
	IsBuiltin    bool
	// Enabled —— owner 全局开关;false = 不进 agent(即使挂在 role 上)。
	Enabled bool
}

// SkillScript —— sandbox-executed code attached to a skill。预留给 B4
// (Docker sandbox)，A1 暂不执行 scripts，但 schema 留位。
type SkillScript struct {
	Filename    string             `json:"filename"`
	Language    string             `json:"language"`
	Content     string             `json:"content"`
	Description string             `json:"description,omitempty"`
	Parameters  []SkillScriptParam `json:"parameters,omitempty"`
}

// SkillScriptParam —— script 入参 schema 描述。
type SkillScriptParam struct {
	Name        string `json:"name"`
	Type        string `json:"type,omitempty"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
}

// ErrSkillNotFound —— skill id 不存在或不属于该 owner。
var ErrSkillNotFound = errors.New("skill not found")

// ErrSkillBuiltinImmutable —— 试图删除 / 重命名 builtin skill。
var ErrSkillBuiltinImmutable = errors.New("builtin skill cannot be modified")

// ErrSkillNameTaken —— 同 owner 下 name 重复（unique constraint）。
var ErrSkillNameTaken = errors.New("skill name already taken in this owner")

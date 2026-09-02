// skill.go —— owner-curated AI persona/capability packs. Design derives from legacy
// standmeet-server/backend/domain/iam/entities.py:Skill +
// gateway/src/runtime/skill-tools.ts.
//
// Each Skill = an extra system prompt segment + an optional sandbox script. An InviteCode
// references a set of skill_ids; a visitor session assembles base persona + the selected
// skill.prompt[]. builtin skills (Code Review / Conversation Report …) are seeded at insert
// time and cannot be deleted.

package entity

import (
	"errors"
	"time"
)

// Skill —— value object for a skills row. Field order follows govet fieldalignment: map
// first (8B header+pad), then time, string, slice, bool last.
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
	// Enabled —— owner's global switch; false = doesn't enter the agent (even if attached
	// to a role).
	Enabled bool
}

// SkillScript —— sandbox-executed code attached to a skill. Reserved for B4 (Docker sandbox);
// A1 doesn't execute scripts yet, but the schema holds the slot.
type SkillScript struct {
	Filename    string             `json:"filename"`
	Language    string             `json:"language"`
	Content     string             `json:"content"`
	Description string             `json:"description,omitempty"`
	Parameters  []SkillScriptParam `json:"parameters,omitempty"`
}

// SkillScriptParam —— schema description for a script's input parameter.
type SkillScriptParam struct {
	Name        string `json:"name"`
	Type        string `json:"type,omitempty"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
}

// ErrSkillNotFound —— skill id doesn't exist or doesn't belong to this owner.
var ErrSkillNotFound = errors.New("skill not found")

// ErrSkillBuiltinImmutable —— attempted to delete / rename a builtin skill.
var ErrSkillBuiltinImmutable = errors.New("builtin skill cannot be modified")

// ErrSkillNameTaken —— name already duplicated under the same owner (unique constraint).
var ErrSkillNameTaken = errors.New("skill name already taken in this owner")

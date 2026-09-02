// prompt.go —— owner-scoped library of persona/instruction fragments.
// Design: [[iam-role-pivot-plan]].
//
// A general-purpose type: once attached to a role, it's semantically a
// "role prompt", but the type itself carries no such restriction. The
// public one (is_builtin=true) is seeded by SeedPublicRole at owner claim
// time; deletion is blocked at the repo layer (ErrPromptBuiltinImmutable).

package entity

import (
	"errors"
	"time"
)

// Prompt —— the domain value object for a prompts row.
//
// Field order follows govet fieldalignment: time first, string after,
// bool last.
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

// PromptInit —— construction parameters.
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

// NewPrompt —— constructs from Init. Pointer param avoids hugeParam lint.
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

// ID —— DB primary key.
func (p *Prompt) ID() string { return p.id }

// OwnerID —— owner-scoped FK.
func (p *Prompt) OwnerID() string { return p.ownerID }

// Name —— prompt slug (unique within the owner).
func (p *Prompt) Name() string { return p.name }

// Body —— the full system prompt fragment text.
func (p *Prompt) Body() string { return p.body }

// Description —— a one-line summary.
func (p *Prompt) Description() string { return p.description }

// IsBuiltin —— whether this is a seeded builtin (true = cannot be deleted
// / renamed).
func (p *Prompt) IsBuiltin() bool { return p.isBuiltin }

// CreatedAt —— creation time.
func (p *Prompt) CreatedAt() time.Time { return p.createdAt }

// UpdatedAt —— last update time.
func (p *Prompt) UpdatedAt() time.Time { return p.updatedAt }

// PublicPromptName —— the name of the builtin public prompt. Used by
// SeedPublicRole.
const PublicPromptName = "public"

// PublicPromptBody —— the system prompt copy for the public prompt.
// Design: docs/design/project/admin-data.js PROMPTS[0]. Owner can edit it.
const PublicPromptBody = "You are an AI proxy for {owner}. " +
	"Answer questions accurately from the visible corpus. " +
	"If you do not know, say so plainly."

// PublicPromptDescription —— a one-line summary of the public prompt.
const PublicPromptDescription = "Plain helpful proxy. No persona overlay."

// The `hiring` prompt the job loop needs used to live here. It belongs to
// that plugin, not the kernel — it now lives in
// internal/owner/jobs/jobs_seed.go, seeded via capabilities.OwnerSeeder.

// ErrPromptNotFound —— prompt id doesn't exist or doesn't belong to this
// owner.
var ErrPromptNotFound = errors.New("prompt not found")

// ErrPromptNameTaken —— duplicate name within the same owner (unique
// constraint).
var ErrPromptNameTaken = errors.New("prompt name already taken in this owner")

// ErrPromptBuiltinImmutable —— attempted to delete or rename a builtin
// prompt.
var ErrPromptBuiltinImmutable = errors.New("builtin prompt cannot be deleted or renamed")

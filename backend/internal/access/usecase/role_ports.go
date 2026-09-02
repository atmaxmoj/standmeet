package usecase

import (
	"context"
	"errors"
)

// The kinds of references a role can mount — data (strings), not types. access does
// not hold a typed port for each reference kind.
const (
	RefPrompt    = "prompt"
	RefSkill     = "skill"
	RefMCPServer = "mcp_server"
)

// Reference-not-found — one sentinel per kind. This is **this port's own**
// vocabulary: owner's / marketplace's sentinels live in their own domains, and
// access recognizing those names would be a reverse dependency (they already depend
// on access). The adapter translates its own "not found" into one of these, and the
// caller speaks in plain language from there.
var (
	// ErrRefPromptNotFound — the mounted prompt doesn't belong to this owner, or
	// doesn't exist.
	ErrRefPromptNotFound = errors.New("role ref: prompt not found")
	// ErrRefSkillNotFound — the mounted skill doesn't belong to this owner, or
	// doesn't exist.
	ErrRefSkillNotFound = errors.New("role ref: skill not found")
	// ErrRefMCPServerNotFound — the mounted external MCP server doesn't belong
	// to this owner, or doesn't exist.
	ErrRefMCPServerNotFound = errors.New("role ref: mcp server not found")
)

// RefValidator — a narrow consumer port that, on a role write, validates that one
// mounted reference (by kind) exists. Does existence checking only (discards the
// entity), so it only returns error; the kind→concrete repo.GetByID dispatch is
// adapted by the composition root. access therefore neither holds a typed surface
// per reference kind, nor reverse-depends on owner/marketplace (they already depend
// on access).
type RefValidator interface {
	RefExists(ctx context.Context, ownerID, kind, id string) error
}

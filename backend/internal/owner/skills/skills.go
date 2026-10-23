// Package skills is the independent Skills subsystem (docs/design spec, 2026-10-22): a skill is a
// named, versioned block of TEXT + METADATA that an agent pulls and follows (the interview loop is
// the first one). Owner ruling, not negotiable:
//
//   - Fully independent. Own storage and versioning; ZERO coupling with corpus, code, microsite or
//     applications — no shared tables, no foreign keys into them, no imports of their packages.
//   - No framework bridge. A skill reaches another subsystem only because the skill's own body
//     tells the agent which public tool to call; the subsystem adds no handbook, no special case.
//   - A skill carries no privilege. What an agent may do while following a skill is decided by the
//     agent's own credentials; this subsystem never grants, scopes or checks authority.
//
// So this package imports nothing from other domains on purpose. The handover (skills.* MCP tools)
// and the DB-backed store are wired at the edges; this package holds the object, the versioning and
// the rules.
package skills

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
)

// Source —— where a skill came from. It is metadata only; it grants nothing.
type Source string

const (
	// SourceBundled —— shipped with StandMeet, preinstalled into the same store, no framework
	// privilege over an owner-written one.
	SourceBundled Source = "bundled"
	// SourceOwner —— written by the owner.
	SourceOwner Source = "owner"
	// SourceThird —— imported from a third-party skill package.
	SourceThird Source = "third-party"
)

// Skill —— one skill's identity and current body. Version names the body an agent received, so a
// report can say which one a run followed.
type Skill struct {
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Slug        string
	Name        string
	Description string
	Body        string // the instruction text the agent follows
	Source      Source
	Version     int
}

// NewInput —— the fields of a skill to create. Passed by pointer (it is wider than a register).
type NewInput struct {
	Slug        string
	Name        string
	Description string
	Body        string
	Source      Source
}

// errors the tools surface as they are.
var (
	ErrNotFound    = errors.New("no such skill")
	ErrNoVersion   = errors.New("no such skill version")
	ErrSlugTaken   = errors.New("a skill with that slug already exists")
	ErrBadSlug     = errors.New("slug must be lowercase letters, digits and hyphens")
	ErrEmptyBody   = errors.New("skill body is empty")
	ErrEmptyName   = errors.New("skill name is empty")
	ErrBundledEdit = errors.New("a bundled skill is replaced by its next release, not edited here")
)

var slugRE = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// Store —— the subsystem's own persistence. Implementations: a DB-backed store at the edge, and an
// in-memory one for tests. It keeps every version; Get returns the current one, GetVersion an
// older one. No method reaches outside the skills tables.
type Store interface {
	Insert(ctx context.Context, ownerID string, s *Skill) error
	// NewVersion appends a version to an existing skill and makes it current.
	NewVersion(ctx context.Context, ownerID, slug, body string, at time.Time) (int, error)
	Delete(ctx context.Context, ownerID, slug string) error
	List(ctx context.Context, ownerID string) ([]Skill, error)
	Get(ctx context.Context, ownerID, slug string) (Skill, error)
	GetVersion(ctx context.Context, ownerID, slug string, version int) (Skill, error)
}

// Service —— the skill use cases over a Store. It holds the rules (slug shape, version discipline,
// bundled skills are not hand-edited) and nothing else.
type Service struct {
	store Store
	now   func() time.Time
}

// NewService —— now defaults to time.Now when nil.
func NewService(store Store, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, now: now}
}

// New —— a new skill at version 1. source is who wrote it (metadata only).
func (s *Service) New(ctx context.Context, ownerID string, in *NewInput) (Skill, error) {
	slug := strings.TrimSpace(in.Slug)
	if !slugRE.MatchString(slug) {
		return Skill{}, ErrBadSlug
	}
	if strings.TrimSpace(in.Name) == "" {
		return Skill{}, ErrEmptyName
	}
	if strings.TrimSpace(in.Body) == "" {
		return Skill{}, ErrEmptyBody
	}
	now := s.now()
	sk := Skill{
		Slug: slug, Name: in.Name, Description: in.Description, Body: in.Body,
		Source: in.Source, Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.store.Insert(ctx, ownerID, &sk); err != nil {
		return Skill{}, err
	}
	return sk, nil
}

// Edit —— a new version of an owner skill's body. The old version stays retrievable (version
// discipline). A bundled skill is not edited here — its next release replaces it.
func (s *Service) Edit(ctx context.Context, ownerID, slug, body string) (Skill, error) {
	if strings.TrimSpace(body) == "" {
		return Skill{}, ErrEmptyBody
	}
	cur, err := s.store.Get(ctx, ownerID, slug)
	if err != nil {
		return Skill{}, err
	}
	if cur.Source == SourceBundled {
		return Skill{}, ErrBundledEdit
	}
	if _, nerr := s.store.NewVersion(ctx, ownerID, slug, body, s.now()); nerr != nil {
		return Skill{}, nerr
	}
	return s.store.Get(ctx, ownerID, slug)
}

// Delete —— remove a skill and all its versions.
func (s *Service) Delete(ctx context.Context, ownerID, slug string) error {
	return s.store.Delete(ctx, ownerID, slug)
}

// List —— every skill, current version, for the owner's management surface.
func (s *Service) List(ctx context.Context, ownerID string) ([]Skill, error) {
	return s.store.List(ctx, ownerID)
}

// Get —— one skill's current version (the handover an agent gets by slug).
func (s *Service) Get(ctx context.Context, ownerID, slug string) (Skill, error) {
	return s.store.Get(ctx, ownerID, slug)
}

// GetVersion —— one skill at an exact version (so a run can replay the body it followed).
func (s *Service) GetVersion(
	ctx context.Context, ownerID, slug string, version int,
) (Skill, error) {
	return s.store.GetVersion(ctx, ownerID, slug, version)
}

// reseedBundled —— a bundled skill ships with the release; when its shipped body changes, append a
// new version (the owner can't hand-edit a bundled skill, but a release replaces it — spec S3). Old
// versions stay retrievable, so a run that followed an earlier release can still replay it.
// Idempotent: a body that already matches the release is left untouched.
func (s *Service) reseedBundled(ctx context.Context, ownerID string, in *NewInput) error {
	cur, err := s.store.Get(ctx, ownerID, in.Slug)
	if err != nil {
		return err
	}
	if cur.Body == in.Body {
		return nil
	}
	_, err = s.store.NewVersion(ctx, ownerID, in.Slug, in.Body, s.now())
	return err
}

// subjectivity_cite.go —— citation resolution for subjectivity as the "private
// visibility tier."
//
// wiki/output entries get cited on read (into the visitor footer); subjectivity entries
// are **not** cited by default on read — they ground the agent's voice but aren't shown
// to visitors. An entry only reaches the footer once the owner opts it in
// (show_as_source=true). This gate is server-authoritative: it never trusts an id the
// client sent, it looks up show_as_source for each one and decides from that.
//
// Both the dialog path (writes cited_subjectivity_ids) and the admin transcript path
// (builds subjectivity_refs) go through here, so "resolve + gate" has exactly one
// definition. path is derived by walking up the parent chain (same as deriveNotePath).

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// SubjectivityCiteRef —— a subjectivity reference that has been resolved and has passed
// the show_as_source gate.
type SubjectivityCiteRef struct {
	ID           string
	Title        string
	Path         string
	Body         string
	ShowAsSource bool
}

// SubjectivityCiteLookup —— a narrow interface resolving a subjectivity id to
// (title/path/body/show_as_source). publicroutes doesn't import postgres directly; the
// concrete implementation is passed through this interface (NewSubjectivityCiteResolver
// wraps a NoteRepo).
type SubjectivityCiteLookup interface {
	ResolveCite(ctx context.Context, ownerID, id string) (SubjectivityCiteRef, error)
}

// subjectivityCiteResolver —— the postgres implementation of SubjectivityCiteLookup:
// looks the note up via NoteRepo (genre='subjectivity'), including show_as_source, and
// derives its tree path by walking up the parent chain.
type subjectivityCiteResolver struct {
	repo *repo.NoteRepo
}

// NewSubjectivityCiteResolver —— for the composition root: wraps a subjectivity NoteRepo
// as a lookup. Returns nil when repo is nil (callers with no subjectivity wiring take
// the no-op resolve path).
//
//nolint:ireturn // nil-safe factory: nil repo returns nil interface, caller nil-guards around it
func NewSubjectivityCiteResolver(notes *repo.NoteRepo) SubjectivityCiteLookup {
	if notes == nil {
		return nil
	}
	return &subjectivityCiteResolver{repo: notes}
}

// ResolveCite —— id -> (title/body/show_as_source) plus the tree-derived path. Not found
// -> ErrSubjectivityNotFound.
func (r *subjectivityCiteResolver) ResolveCite(
	ctx context.Context, ownerID, id string,
) (SubjectivityCiteRef, error) {
	note, err := r.repo.GetByID(ctx, ownerID, id)
	if err != nil {
		if errors.Is(err, repo.ErrNoteNotFound) {
			return SubjectivityCiteRef{}, entity.ErrSubjectivityNotFound
		}
		return SubjectivityCiteRef{}, fmt.Errorf("get subjectivity: %w", err)
	}
	path, perr := deriveNotePath(ctx, r.repo, ownerID, id)
	if perr != nil {
		return SubjectivityCiteRef{}, fmt.Errorf("derive subjectivity path: %w", perr)
	}
	return SubjectivityCiteRef{
		ID: note.ID, Title: note.Title, Path: path,
		Body: note.Body, ShowAsSource: note.ShowAsSource,
	}, nil
}

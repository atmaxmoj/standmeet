// subjectivity.go —— use cases for the subjectivity genre: the owner writes
// (creates/edits) a self-model note. Goes through the generic NoteRepo
// (genre='subjectivity'). Parent validation + cycle prevention + tree-derived path
// are all built genre-generic (validateNoteParent/…, deriveNotePath), so they're
// reusable once wiki/output converge onto NoteRepo too.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// WriteSubjectivityInput —— input for subjectivity_write. Empty ID = create;
// non-empty = update/reparent.
// ShowAsSource: opts this subjectivity note into the visitor-cited footer. Defaults
// to false (private) — the capability layer passes false when the arg is omitted,
// the opposite of wiki/output's default of true.
type WriteSubjectivityInput struct {
	OwnerID      string
	ID           string
	ParentID     *string
	Title        string
	Body         string
	Tags         []string
	CSSClasses   []string
	ShowAsSource bool
}

// SubjectivityResult —— returns id + tree-derived path after create/update (for MCP
// to echo back, and for visitor addressing by path).
type SubjectivityResult struct {
	ID   string
	Path string
}

// DeleteSubjectivity hard-deletes a subjectivity note (descendants cascade via FK).
func DeleteSubjectivity(ctx context.Context, deps Deps, ownerID, id string) error {
	if err := deps.Subjectivity.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete subjectivity: %w", err)
	}
	deleteNoteHook(ctx, deps, id)
	return nil
}

// WriteSubjectivity creates or updates a subjectivity note.
func WriteSubjectivity(
	ctx context.Context, deps Deps, in *WriteSubjectivityInput,
) (SubjectivityResult, error) {
	if in.OwnerID == "" || in.Title == "" {
		return SubjectivityResult{}, apierr.ErrEmptyField
	}
	note, err := writeNote(ctx, deps.Subjectivity, in)
	if err != nil {
		return SubjectivityResult{}, err
	}
	return finishSubjectivityWrite(ctx, deps, in.OwnerID, note.ID, in.Body)
}

// finishSubjectivityWrite —— post-write: rebuilds `[[X]]` outbound edges + computes
// the tree-derived path. Split out so WriteSubjectivity's cyclomatic complexity
// stays under the limit.
func finishSubjectivityWrite(
	ctx context.Context, deps Deps, ownerID, id, body string,
) (SubjectivityResult, error) {
	if rerr := RebuildNoteRefs(ctx, deps, ownerID, id, body); rerr != nil {
		return SubjectivityResult{}, fmt.Errorf("rebuild subjectivity refs: %w", rerr)
	}
	indexNoteHook(ctx, deps, ownerID, id)
	path, perr := deriveNotePath(ctx, deps.Subjectivity, ownerID, id)
	if perr != nil {
		return SubjectivityResult{}, fmt.Errorf("derive subjectivity path: %w", perr)
	}
	return SubjectivityResult{ID: id, Path: path}, nil
}

func writeNote(
	ctx context.Context, notes *repo.NoteRepo, in *WriteSubjectivityInput,
) (repo.Note, error) {
	if in.ID == "" {
		return createNote(ctx, notes, in)
	}
	return updateNote(ctx, notes, in)
}

func createNote(
	ctx context.Context, notes *repo.NoteRepo, in *WriteSubjectivityInput,
) (repo.Note, error) {
	if err := validateNoteParent(ctx, notes, in.OwnerID, in.ParentID); err != nil {
		return repo.Note{}, err
	}
	note, err := notes.Create(ctx, &repo.CreateNoteInput{
		OwnerID: in.OwnerID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		CSSClasses: in.CSSClasses, ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return repo.Note{}, fmt.Errorf("create subjectivity: %w", err)
	}
	return note, nil
}

func updateNote(
	ctx context.Context, notes *repo.NoteRepo, in *WriteSubjectivityInput,
) (repo.Note, error) {
	if err := validateNoteReparent(ctx, notes, in.OwnerID, in.ID, in.ParentID); err != nil {
		return repo.Note{}, err
	}
	note, err := notes.UpdateBody(ctx, &repo.UpdateNoteInput{
		OwnerID: in.OwnerID, ID: in.ID, ParentID: in.ParentID,
		Title: in.Title, Body: in.Body, Tags: in.Tags,
		CSSClasses: in.CSSClasses, ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return repo.Note{}, fmt.Errorf("update subjectivity: %w", err)
	}
	return note, nil
}

// validateNoteParent —— if a parent is given, it must be a note of the same genre
// owned by this owner, or ErrParentNotFound.
func validateNoteParent(
	ctx context.Context, notes *repo.NoteRepo, ownerID string, parentID *string,
) error {
	if parentID == nil || *parentID == "" {
		return nil
	}
	if _, err := notes.GetByID(ctx, ownerID, *parentID); err != nil {
		if errors.Is(err, repo.ErrNoteNotFound) {
			return entity.ErrParentNotFound
		}
		return fmt.Errorf("validate note parent: %w", err)
	}
	return nil
}

// validateNoteReparent —— reparenting: existence + same owner + cycle prevention
// (can't be attached under itself or its own descendants).
func validateNoteReparent(
	ctx context.Context, notes *repo.NoteRepo, ownerID, nodeID string, parentID *string,
) error {
	if err := validateNoteParent(ctx, notes, ownerID, parentID); err != nil {
		return err
	}
	if parentID == nil || *parentID == "" {
		return nil
	}
	return checkNoteCycle(ctx, notes, ownerID, nodeID, *parentID)
}

func checkNoteCycle(
	ctx context.Context, notes *repo.NoteRepo, ownerID, nodeID, parentID string,
) error {
	cur := parentID
	for range TreeMaxDepth {
		if cur == nodeID {
			return entity.ErrParentCycle
		}
		n, err := notes.GetByID(ctx, ownerID, cur)
		if err != nil {
			return fmt.Errorf("note cycle check: %w", err)
		}
		if n.ParentID == nil {
			return nil
		}
		cur = *n.ParentID
	}
	return nil
}

// deriveNotePath —— walks up the note's parent chain, slugifies each segment's
// title, and joins them into the tree-derived path.
func deriveNotePath(
	ctx context.Context, notes *repo.NoteRepo, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, TreeMaxDepth)
	cur := id
	for range TreeMaxDepth {
		n, err := notes.GetByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("get note for path: %w", err)
		}
		segs = append([]string{PathSegment(n.Title)}, segs...)
		if n.ParentID == nil {
			break
		}
		cur = *n.ParentID
	}
	return strings.Join(segs, "/"), nil
}

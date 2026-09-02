// corpus.go — raw / wiki use cases.
// Currently implements RawDump + PromoteToWiki + List. The rest (UploadMedia /
// SetTags, etc.) get added only when actually needed.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// Deps — the set of repos that raw + wiki + output + path operations need.
type Deps struct {
	Raw          *repo.RawRepo
	Wiki         *repo.WikiRepo
	Output       *repo.OutputRepo
	NoteRefs     *repo.NoteRefRepo
	Subjectivity *repo.NoteRepo
	// VaultSync — Obsidian vault sync: cross-genre reconcile (admin-side wiring only).
	VaultSync *repo.VaultSyncRepo
	// Index — Meili index propagation; nil = Meili not configured, write path
	// skips indexing (best-effort).
	Index Indexer
	// Media — the assets (images / attachments / hero) attached to a piece of corpus content.
	// **Any genre can have them** — the underlying assets table keys off holder_id, has no
	// genre column, and has always been generic; the only thing missing is the wiring.
	Media *NoteAssetsDeps
}

// HasMedia — whether this wiring has media plugged in. If not (some read-only
// paths), the steps that read/write media are skipped instead of nil-panicking.
func (d Deps) HasMedia() bool { return d.Media.ready() }

// RawDumpInput is the raw_dump input.
type RawDumpInput struct {
	OwnerID        string
	Body           string
	Source         string
	Tags           []string
	FlaggedPrivate bool
}

// RawDump writes a new raw_entries row. Called by the MCP tool; the source
// label comes from the owner's AI client.
func RawDump(ctx context.Context, deps Deps, in *RawDumpInput) (entity.Raw, error) {
	if in.OwnerID == "" || in.Body == "" {
		return entity.Raw{}, apierr.ErrEmptyField
	}
	src := in.Source
	if src == "" {
		src = "mcp"
	}
	raw, err := deps.Raw.Create(ctx, &repo.CreateRawInput{
		OwnerID:        in.OwnerID,
		Body:           in.Body,
		Source:         src,
		Tags:           in.Tags,
		FlaggedPrivate: in.FlaggedPrivate,
	})
	if err != nil {
		return entity.Raw{}, fmt.Errorf("raw create: %w", err)
	}
	return raw, nil
}

// PromoteInput is the promote_to_wiki input.
//
// path / show_as_source live outside this layer — the MCP tool layer takes
// path, calls PromoteToWiki, then separately calls SEORepo.UpdateWikiSEO /
// WikiRepo.Update to set it (each multi-step write stays its own atomic unit).
type PromoteInput struct {
	OwnerID  string
	RawID    string
	Title    string
	ParentID *string
	// ShowAsSource — nil = citable (default). A promoted entry is citable by
	// default; hiding it (the meta/persona kind) must be an explicit caller request.
	ShowAsSource *bool
	Tags         []string
}

// PromoteToWiki promotes the given raw entry into a new wiki entry: read the
// original raw → create the wiki entry carrying a raw_id back-link → mark the
// raw as promoted_to.
func PromoteToWiki(
	ctx context.Context, deps Deps, in *PromoteInput,
) (entity.Wiki, error) {
	if err := preflightPromote(ctx, deps, in); err != nil {
		return entity.Wiki{}, err
	}
	raw, err := loadRawForPromote(ctx, deps, in)
	if err != nil {
		return entity.Wiki{}, err
	}
	wiki, err := deps.Wiki.Create(ctx, &repo.CreateWikiInput{
		OwnerID:      in.OwnerID,
		ParentID:     in.ParentID,
		Title:        in.Title,
		Body:         raw.Body(),
		Tags:         mergeTags(raw.Tags(), in.Tags),
		SourceRawIDs: []string{raw.ID()},
		ShowAsSource: in.ShowAsSource,
	})
	if err != nil {
		return entity.Wiki{}, fmt.Errorf("wiki create: %w", err)
	}
	fin := promoteFinish{OwnerID: in.OwnerID, RawID: raw.ID(), WikiID: wiki.ID(), Body: raw.Body()}
	if perr := finishPromote(ctx, deps, fin); perr != nil {
		return entity.Wiki{}, perr
	}
	return wiki, nil
}

// promoteFinish — bundles finishPromote's input (keeps the argument count under
// the argument-limit of 5).
type promoteFinish struct {
	OwnerID string
	RawID   string
	WikiID  string
	Body    string
}

// finishPromote — marks the raw as promoted, then rebuilds this wiki entry's
// [[X]] outgoing edges. Uses raw.Body() (the wiki entry Create returns doesn't
// necessarily have body filled back in). Kept in one place so PromoteToWiki's
// cyclomatic complexity stays within budget.
func finishPromote(ctx context.Context, deps Deps, f promoteFinish) error {
	if perr := deps.Raw.MarkPromoted(ctx, f.OwnerID, f.RawID, f.WikiID); perr != nil {
		return fmt.Errorf("mark promoted: %w", perr)
	}
	if rerr := RebuildNoteRefs(ctx, deps, f.OwnerID, f.WikiID, f.Body); rerr != nil {
		return rerr
	}
	indexNoteHook(ctx, deps, f.OwnerID, f.WikiID)
	return nil
}

// preflightPromote — the three gates before a promote: required fields present,
// parent valid, and no sibling-slug collision. Kept in one place so
// PromoteToWiki's cyclomatic complexity stays within budget.
func preflightPromote(ctx context.Context, deps Deps, in *PromoteInput) error {
	if err := validatePromoteInput(in); err != nil {
		return err
	}
	if err := validateWikiParent(ctx, deps, in.OwnerID, in.ParentID); err != nil {
		return err
	}
	return ensureSiblingSlugFree(ctx, deps, siblingSlugCheck{
		OwnerID: in.OwnerID, ParentID: in.ParentID, Title: in.Title,
	})
}

// siblingScanLimit — the collision check scans siblings under the same parent.
// A hand-curated directory won't hold thousands of documents; a generous cap
// lets us scan them all in one pass (no pagination), enough for any real tree.
const siblingScanLimit = 10_000

// siblingSlugCheck — bundles ensureSiblingSlugFree's input (keeps the argument
// count under the argument-limit of 5). ExcludeID is for update's self-check:
// renaming to your own current slug isn't a collision; empty means a pure create.
type siblingSlugCheck struct {
	OwnerID   string
	ParentID  *string
	Title     string
	ExcludeID string
}

// ensureSiblingSlugFree — Obsidian-semantics write-time collision guard: under
// the same parent (root included), two siblings can't share a title slug, or
// the address path stops being 1:1. The slug isn't stored (it's tree-derived),
// so it can't be queried by slug in SQL — instead we pull that parent's
// siblings and compare PathSegment in Go. A collision returns
// ErrSiblingSlugTaken.
func ensureSiblingSlugFree(ctx context.Context, deps Deps, c siblingSlugCheck) error {
	slug := PathSegment(c.Title)
	sibs, err := deps.Wiki.ListChildren(ctx, c.OwnerID, c.ParentID, siblingScanLimit, 0)
	if err != nil {
		return fmt.Errorf("list siblings for slug check: %w", err)
	}
	for i := range sibs {
		if sibs[i].ID == c.ExcludeID {
			continue
		}
		if PathSegment(sibs[i].Title) == slug {
			return entity.ErrSiblingSlugTaken
		}
	}
	return nil
}

func validatePromoteInput(in *PromoteInput) error {
	if in.OwnerID == "" || in.RawID == "" || in.Title == "" {
		return apierr.ErrEmptyField
	}
	return nil
}

// validateWikiParent — if parent_id is given it must be a wiki entry owned by
// this owner (the FK only guarantees the id exists in corpus_notes, not that it
// belongs to this owner; a cross-owner parent would slip through). Not found →
// ErrParentNotFound; an invalid parent must never be allowed to orphan the
// entry. An empty parent (root) is allowed through.
func validateWikiParent(
	ctx context.Context, deps Deps, ownerID string, parentID *string,
) error {
	if parentID == nil || *parentID == "" {
		return nil
	}
	if _, err := deps.Wiki.GetByID(ctx, ownerID, *parentID); err != nil {
		if errors.Is(err, entity.ErrWikiNotFound) {
			return entity.ErrParentNotFound
		}
		return fmt.Errorf("validate wiki parent: %w", err)
	}
	return nil
}

// validateWikiReparent — used by UpdateWiki when changing parent: existence +
// same-owner (validateWikiParent) + cycle guard (nodeID can't be attached under
// itself or its own descendants).
func validateWikiReparent(
	ctx context.Context, deps Deps, ownerID, nodeID string, parentID *string,
) error {
	if err := validateWikiParent(ctx, deps, ownerID, parentID); err != nil {
		return err
	}
	if parentID == nil || *parentID == "" {
		return nil
	}
	return checkNoParentCycle(ctx, deps, ownerID, nodeID, *parentID)
}

// checkNoParentCycle — walks up the parent chain from the proposed parent to
// the root; hitting nodeID along the way means a cycle (the node would be
// attached under itself / its own descendants) → ErrParentCycle.
func checkNoParentCycle(
	ctx context.Context, deps Deps, ownerID, nodeID, parentID string,
) error {
	cur := parentID
	for range TreeMaxDepth {
		if cur == nodeID {
			return entity.ErrParentCycle
		}
		w, err := deps.Wiki.GetByID(ctx, ownerID, cur)
		if err != nil {
			return fmt.Errorf("cycle check: %w", err)
		}
		pid, ok := w.ParentID()
		if !ok {
			return nil
		}
		cur = pid
	}
	return nil
}

func loadRawForPromote(
	ctx context.Context, deps Deps, in *PromoteInput,
) (entity.Raw, error) {
	raw, err := deps.Raw.GetByID(ctx, in.OwnerID, in.RawID)
	if err != nil {
		if errors.Is(err, entity.ErrRawNotFound) {
			return entity.Raw{}, entity.ErrRawNotFound
		}
		return entity.Raw{}, fmt.Errorf("get raw: %w", err)
	}
	return raw, nil
}

// mergeTags merges raw.tags with the extra tags given at promote time,
// deduplicating while preserving order.
func mergeTags(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	appendUnique(&out, seen, a)
	appendUnique(&out, seen, b)
	return out
}

func appendUnique(out *[]string, seen map[string]bool, in []string) {
	for _, t := range in {
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		*out = append(*out, t)
	}
}

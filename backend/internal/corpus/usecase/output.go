// output.go — the promote path into output, the most refined of the raw → wiki → output layers.
//
// PromoteWikiToOutput: distills an already-curated wiki into an output.
// Promoting leaves the wiki untouched (unlike raw.promoted_to's marker) — one wiki can spawn
// several outputs, and the wiki itself stays usable by chat retrieval. output.source_wiki_ids
// records the backlink.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// PromoteToOutputInput — the promote_wiki_to_output input. Title is required (unlike the raw→
// wiki promote, where the owner might want a new title, here reusing the original wiki title is
// fine too; the owner's AI client will often rewrite it anyway).
type PromoteToOutputInput struct {
	OwnerID  string
	WikiID   string
	Title    string
	ParentID *string
	// ShowAsSource — nil = referenceable (default). See the same-named field on PromoteInput.
	ShowAsSource *bool
	Tags         []string
}

// PromoteWikiToOutput distills the given wiki into a new output entry: read the wiki → create
// the output carrying a wiki_id backlink. The wiki itself is left untouched (unlike
// raw.promoted_to's marker).
func PromoteWikiToOutput(
	ctx context.Context, deps Deps, in *PromoteToOutputInput,
) (entity.Output, error) {
	if err := validatePromoteToOutputInput(in); err != nil {
		return entity.Output{}, err
	}
	wiki, err := loadWikiForPromote(ctx, deps, in.OwnerID, in.WikiID)
	if err != nil {
		return entity.Output{}, err
	}
	out, err := deps.Output.Create(ctx, &repo.CreateOutputInput{
		OwnerID:       in.OwnerID,
		ParentID:      in.ParentID,
		Title:         in.Title,
		Body:          wiki.Body(),
		Tags:          mergeTags(wiki.Tags(), in.Tags),
		SourceWikiIDs: []string{wiki.ID()},
		ShowAsSource:  in.ShowAsSource,
	})
	if err != nil {
		return entity.Output{}, fmt.Errorf("output create: %w", err)
	}
	if rerr := RebuildNoteRefs(ctx, deps, in.OwnerID, out.ID(), wiki.Body()); rerr != nil {
		return entity.Output{}, fmt.Errorf("rebuild output refs: %w", rerr)
	}
	indexNoteHook(ctx, deps, in.OwnerID, out.ID())
	return out, nil
}

func validatePromoteToOutputInput(in *PromoteToOutputInput) error {
	if in.OwnerID == "" || in.WikiID == "" || in.Title == "" {
		return apierr.ErrEmptyField
	}
	return nil
}

func loadWikiForPromote(
	ctx context.Context, deps Deps, ownerID, wikiID string,
) (entity.Wiki, error) {
	wiki, err := deps.Wiki.GetByID(ctx, ownerID, wikiID)
	if err != nil {
		if errors.Is(err, entity.ErrWikiNotFound) {
			return entity.Wiki{}, entity.ErrWikiNotFound
		}
		return entity.Wiki{}, fmt.Errorf("get wiki: %w", err)
	}
	return wiki, nil
}

// Package ops — what the corpus domain can do, declared by the domain
// **itself**.
//
// One operation is a complete unit here: a stable id, a caller-facing
// description, an input schema, a semantic kind, exposure intent (which
// surfaces owe it), and an implementation — the implementation just calls
// this domain's use case, through no intermediate shape.
//
// Why here and not at the convergence point: if the convergence point
// declared for each domain, it would have to restate every domain's existing
// inputs and outputs, so each new operation would add a second name for the
// same concept, and the two would inevitably drift. A domain says what it can
// do; the convergence point only gathers these declarations, adds decorators,
// and projects them onto each surface.
package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// Subjectivity — operations for the self-model genre.
//
// MCP-only is a product decision: the self-model is something the owner
// works out in conversation with their own AI, not something typed into a
// form.
func Subjectivity(deps usecase.Deps) []fp.Op {
	return []fp.Op{{
		// Keep the id the name the owner's AI has always used — a relocation
		// shouldn't rename the public-facing label.
		ID: "subjectivity_write",
		Description: "Write (create or update) a subjectivity note — the owner's self-model: " +
			"taste, judgment, what they care about. Prose; the address is derived from the " +
			"title and the tree. Private unless show_as_source says otherwise.",
		InputSchema: subjectivitySchema,
		Kind:        fp.Action,
		// **This is a historical alias, not a capability restriction.**
		//
		// Its old rationale said "the self-model is worked out in
		// conversation, not typed into a form" — that was a preference
		// baked into code, and it used to keep subjectivity out of the
		// panel. That restriction is gone: subjectivity now goes through
		// corpus.create / corpus.update like the other three genres, so
		// the panel can create and edit it too.
		//
		// This id stays because the owner's AI already calls it by this
		// name (CLAUDE.md says so too). The panel needs no second path,
		// so this only projects to mcp — the difference is in the
		// **name**, not the capability.
		Reach: fp.Only(
			"a historical tool name the owner's AI already calls; the panel writes this genre "+
				"through corpus.create / corpus.update like every other genre", "mcp"),
		Invoke: writeSubjectivity(deps),
	}}
}

var subjectivitySchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"title":{"type":"string","description":"Note title (its path segment)."},
		"body":{"type":"string","description":"Prose body."},
		"subjectivity_id":{"type":"string",
			"description":"Existing note id to update or reparent; empty creates a new one."},
		"parent_id":{"type":"string",
			"description":"Parent note id; root when empty. The path is tree-derived."},
		"tags":{"type":"array","items":{"type":"string"}},
		"css_classes":{"type":"array","items":{"type":"string"}},
		"show_as_source":{"type":"boolean",
			"description":"Cite this note to visitors. Defaults to false — this genre is private."},
		"cover_image_asset_id":{"type":"string",
			"description":"Hero image: an asset_id from assets.upload; '' clears it."},
		"cover_headline":{"type":"string","description":"The line laid over the hero image."},
		"cover_hue":{"type":"string","description":"Hero hue: 'amber' | 'violet' | 'acid'."}
	},
	"required":["title","body"]
}`)

// subjectivityArgs — the wire-level input. show_as_source is a pointer
// because this genre's default is **private**, the opposite of wiki / output
// — a bool's zero value can't express "not mentioned".
// The three hero fields are **pointers**: omitted means leave alone, not
// "clear it". Same rule as corpus.update — existing callers omit every hero
// field, so treating that as clearing would wipe the owner's cover on every
// body edit.
type subjectivityArgs struct {
	ShowAsSource      *bool    `json:"show_as_source"`
	CoverImageAssetID *string  `json:"cover_image_asset_id"`
	CoverHeadline     *string  `json:"cover_headline"`
	CoverHue          *string  `json:"cover_hue"`
	Title             string   `json:"title"`
	Body              string   `json:"body"`
	ID                string   `json:"subjectivity_id"`
	ParentID          string   `json:"parent_id"`
	Tags              []string `json:"tags"`
	CSSClasses        []string `json:"css_classes"`
}

// hero — the hero fields to change this call. All nil means hero wasn't
// mentioned at all, and touches the database not once.
func (in *subjectivityArgs) hero() usecase.HeroPatch {
	return usecase.HeroPatch{
		CoverAssetID: in.CoverImageAssetID, CoverHeadline: in.CoverHeadline,
		CoverHue: in.CoverHue,
	}
}

func writeSubjectivity(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, perr := decodeSubjectivityArgs(raw)
		if perr != nil {
			return nil, perr
		}
		res, err := usecase.WriteSubjectivity(ctx, deps, args.toInput(ownerID))
		if err != nil {
			return nil, subjectivityErr(err)
		}
		if herr := applySubjectivityHero(ctx, deps, ownerID, res.ID, &args); herr != nil {
			return nil, herr
		}
		return json.Marshal(subjectivityOut{ID: res.ID, Path: res.Path})
	}
}

// applySubjectivityHero — the hero fields are written **after** the corpus
// entry is persisted: they attach to this note, and there's nowhere to attach
// them before the note has an id. If no hero field was given at all, this
// touches the database not once.
func applySubjectivityHero(
	ctx context.Context, deps usecase.Deps, ownerID, id string, args *subjectivityArgs,
) error {
	hero := args.hero()
	if !hero.Touched() {
		return nil
	}
	return writeHero(ctx, deps, ownerID, id, &hero)
}

// subjectivityOut — what's returned to the caller after a write: this note's
// id and its address.
type subjectivityOut struct {
	ID   string `json:"subjectivity_id"`
	Path string `json:"path"`
}

func decodeSubjectivityArgs(raw json.RawMessage) (subjectivityArgs, error) {
	var in subjectivityArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"title", in.Title}, [2]string{"body", in.Body},
	); err != nil {
		return in, err
	}
	return in, nil
}

func (in *subjectivityArgs) toInput(ownerID string) *usecase.WriteSubjectivityInput {
	out := &usecase.WriteSubjectivityInput{
		OwnerID: ownerID, ID: in.ID, Title: in.Title, Body: in.Body,
		Tags: in.Tags, CSSClasses: in.CSSClasses,
		ShowAsSource: in.ShowAsSource != nil && *in.ShowAsSource,
	}
	if in.ParentID != "" {
		parent := in.ParentID
		out.ParentID = &parent
	}
	return out
}

// subjectivityErr — this domain's sentinels → protocol-agnostic error
// classes. The translation lives in the domain, because the domain is what
// knows whether a given sentinel means the caller got it wrong or the thing
// just doesn't exist.
func subjectivityErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrParentNotFound):
		return fp.Coded(fp.NotFound("parent entry not found"), "parent_not_found")
	case errors.Is(err, entity.ErrParentCycle):
		return fp.Coded(fp.BadInput("cannot reparent: that would create a cycle"), "parent_cycle")
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.BadInput("title and body are required")
	}
	return fp.OpErr("write subjectivity", err)
}

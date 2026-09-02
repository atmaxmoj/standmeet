// corpus_write_args.go — the **shape** of one write request, and what "not given" means
// for each field.
//
// This isn't corpus_write.go split in two to pad line counts, it's a self-contained
// problem on its own: `corpus.update`'s schema only requires `genre` + `id`, so **every
// other field may be absent**, and what absence means is different for each field —
//
//	body / title      absent = an empty value in a full replace (blocked downstream by
//	                  non-empty validation, see UpdateRaw / hasBlankCorpusField)
//	parent_id         absent = leave alone; empty string = move to root      (F-L-28)
//	show_as_source    absent = stays referenceable                (a contract, not a default)
//	flagged_private   absent = leave alone                                  (F-L-57)
//	the 3 hero fields absent = leave alone            (existing callers carry none of them)
//
// This table got learned the hard way four times, and every time it was the same shape:
// **a bare value can't express "not given"**, so "wasn't mentioned" got treated as "set to
// zero value" — the compiler doesn't catch it, the response reports success, and nothing
// shows up on screen. Each of the four incidents fixed only the one field at hand
// ([[lesson-not-swept-to-neighbours]]) — so now they all live together here, and whoever
// adds the next field should read this first.
//
// WARNING **the pointers here are hand-rolled, and the house already has a ready-made
// version**: `fp.OptionalString` / `OptionalBool` / `OptionalInt32`
// (`internal/infra/facadeparity/optional.go`) do exactly this — `Set` records precisely
// "did the caller mention this field or not". `seo.update_settings` uses it, and its
// Description spells out "Omitted fields keep ...". corpus and roles each hand-rolled their
// own equivalent — it works, but the **vocabulary has forked**
// ([[vocabulary-must-not-diverge]]). Consolidating onto fp.Optional* is a TODO, not in
// scope for this change; leaving this note here so a third version doesn't happen.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// corpusWriteArgs — the shared input shape for create and update. Which fields matter
// for which genre is decided by the dispatch logic.
type corpusWriteArgs struct {
	// The 3 hero fields: not given = leave alone, not "clear". Existing callers carry
	// none of the hero fields, so following the "full replace" rule as-is would wipe the
	// owner's hero on every single body edit.
	CoverImageAssetID *string `json:"cover_image_asset_id"`
	CoverHeadline     *string `json:"cover_headline"`
	CoverHue          *string `json:"cover_hue"`
	// FlaggedPrivate — the same lesson for the fourth time: it used to be a bare bool, so
	// the owner's AI saying "edit this body a bit" (`{genre,id,body}`) would **silently
	// clear** the owner's private flag, and the response would still report success.
	FlaggedPrivate *bool  `json:"flagged_private"`
	Genre          string `json:"genre"`
	ID             string `json:"id"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	// ParentID — nil = the request doesn't carry this field = **leave alone**; points to
	// "" = explicitly move to root; points to an id = move there.
	//
	// It used to be a bare string, so "parent not mentioned" and "move to root" were the
	// same value. The panel's edit form neither displays nor sends this field back
	// (F-L-28), so the owner edits the body once and the note gets slammed to root — and
	// **the tree IS the corpus address**: `uriOf` = `genre://<path>`, and role/code ACL
	// globs are built on that path. Once a note's address changes, an owner's
	// `wiki://a/b/**` rule silently stops covering it, with nothing shown on screen.
	ParentID     *string  `json:"parent_id"`
	Source       string   `json:"source"`
	ShowAsSource *bool    `json:"show_as_source"`
	Tags         []string `json:"tags"`
	CSSClasses   []string `json:"css_classes"`
}

// showAsSource — not given means true.
//
// **This is a contract, not a default-value choice**: a piece of corpus content is a
// referenceable source the moment it's created; hiding it (the meta/persona kind) is an
// exception the owner explicitly asked for. Before genre got parameterized, this was
// `args.ShowAsSource == nil || *args.ShowAsSource`; during parameterization it got rewritten
// as a bare bool — so "field not mentioned" flipped from "stays referenceable" to "gets
// hidden", and the compiler didn't catch it, nor did whoever made the change notice.
func (a *corpusWriteArgs) showAsSource() bool {
	return a.ShowAsSource == nil || *a.ShowAsSource
}

// flaggedPrivate — on **create**, not given means false (a new entry defaults to
// non-private). Don't use this on update — use keptFlaggedPrivate instead, where
// "not given" means **leave alone**.
func (a *corpusWriteArgs) flaggedPrivate() bool {
	return a.FlaggedPrivate != nil && *a.FlaggedPrivate
}

func decodeCorpusWrite(raw json.RawMessage) (corpusWriteArgs, error) {
	var in corpusWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, requireGenre(in.Genre)
}

// parentOrNil — on **create**: not given / given as an empty string both mean attach
// at root; neither is an error.
func parentOrNil(id *string) *string {
	if id == nil || *id == "" {
		return nil
	}
	return id
}

// keptParentID — on **update**: if the request doesn't carry parent_id, keep the entry's
// current parent (leave alone); only an explicit empty string means "move to root".
//
// Why the extra read: downstream, `UpdateWikiInput.ParentID`'s nil means "move to root" —
// that convention was fixed by the **create** path, and changing it would touch every call
// site. So "leave alone" gets resolved at this layer instead — read back the current value
// and pass it through unchanged.
func keptParentID(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (*string, error) {
	if in.ParentID != nil {
		return parentOrNil(in.ParentID), nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return nil, err
	}
	return cur.ParentID, nil
}

// keptFlaggedPrivate — on **update**: if the request doesn't carry flagged_private, keep
// its current value (leave alone). Same shape, same reasoning as keptParentID — except
// getting this one wrong is deadly serious: it's the flag marking "don't let this one out".
func keptFlaggedPrivate(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (bool, error) {
	if in.FlaggedPrivate != nil {
		return *in.FlaggedPrivate, nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return false, err
	}
	return cur.FlaggedPrivate, nil
}

// keptTags / keptCSSClasses — two more fields under the same rule.
//
// **Fixed together this time, not one field at a time**: these three fields are three
// faces of the same defect (F-L-57), and the table at the top of this file was already
// counting a fourth occurrence. A slice naturally distinguishes "not given" (nil) from
// "explicitly cleared" (`[]`), so no pointer is needed here — what's needed is just
// someone reading that distinction.
//
// css_classes is especially well-hidden: no owner-side read endpoint sends it back, yet
// **the visitor side uses it** (`WikiReaderClient` renders the note by it). Clear it with
// one body edit, and the regression only ever shows up on the visitor's screen.
func keptTags(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) ([]string, error) {
	if in.Tags != nil {
		return in.Tags, nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return nil, err
	}
	return cur.Tags, nil
}

func keptCSSClasses(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) ([]string, error) {
	if in.CSSClasses != nil {
		return in.CSSClasses, nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return nil, err
	}
	return cur.CSSClasses, nil
}

// kept — reads back this entry's current state. Every kept* function above needs it —
// the cost of one extra read is far smaller than "silently wiping a field".
func kept(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	return getByGenre(ctx, deps, ownerID, corpusGetArgs{Genre: in.Genre, ID: in.ID})
}

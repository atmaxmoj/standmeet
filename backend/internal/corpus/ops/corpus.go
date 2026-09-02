// corpus.go —— the resource corpus:owner, the owner's corpus itself. raw (dump-as-you-think) /
// wiki (tidied) / output (public-facing final) are **parameters of the same thing**, not three
// separate things — the admin panel has long been one route, `/corpus/{genre}`, while MCP still
// exposes three tools: list_recent_raw / list_recent_wiki / list_recent_output. This file
// consolidates them into one.
//
// One entry has **the same shape** (corpusItemOut) across all three genres: a field that
// doesn't apply is left at its zero value. Those three separate shapes are exactly what this
// pass eliminates — before normalization, admin had wikiListItem / outputListItem / rawListItem
// and MCP had wikiCapView / rawCapView: five shapes, each slightly different from the rest.
//
// body ships only on the raw list: a raw card can be edited in place, so the list has to carry
// the body; wiki / output lists only give a preview (a clean lead paragraph) — the full body
// needs corpus.get. That's a product distinction, not two surfaces fighting each other.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// The genre constants + which genres each op accepts all live in genres.go — that question used
// to be answered separately in three places, now it's answered in one.

const (
	// defaultCorpusLimit / maxCorpusLimit —— the list window. Admin and MCP share one bound.
	defaultCorpusLimit = 50
	maxCorpusLimit     = 200
	// previewMaxLen —— length of the clean lead paragraph shown on a card.
	previewMaxLen = 200
)

// CorpusReads —— list / get. The write half lives in corpus_write.go.
func CorpusReads(deps usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "corpus.list",
			Description: "List corpus entries of one genre, newest first. genre is 'raw', " +
				"'wiki' or 'output'. Raw items carry their body (the card edits it in place); " +
				"wiki and output carry a clean lead preview — fetch the body with corpus.get.",
			InputSchema: corpusListSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCorpus(deps),
		},
		{
			ID: "corpus.get",
			Description: "Read one corpus entry in full by genre + id: body, tags, its place " +
				"in the tree, the notes it links to / is linked from, and its files. " +
				"Works for every genre including 'subjectivity'.",
			InputSchema: corpusGetSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getCorpus(deps),
		},
	}
}

var (
	corpusListSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string","description":"'raw' | 'wiki' | 'output'."},
			"limit":{"type":"integer","description":"Max rows (default 50, max 200)."}
		},
		"required":["genre"]
	}`)

	corpusGetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
			"id":{"type":"string","description":"Entry id."}
		},
		"required":["genre","id"]
	}`)
)

// corpusItemOut —— the one shape a corpus entry takes on every surface.
//
// Shared by all three genres: raw has no title / excerpt, wiki has no source_wiki_ids, output has
// no status — whatever doesn't apply is just the zero value. Every field name here is already
// shipped (the admin panel's zod schema reads them by these names).
type corpusItemOut struct {
	ParentID *string `json:"parent_id"`
	Path     *string `json:"path"`
	// The hero block — image + the headline overlaid on it + a hue. All three live on the
	// shared table, so **any genre can have them**.
	CoverImageAssetID *string           `json:"cover_image_asset_id,omitempty"`
	AssetURLs         map[string]string `json:"asset_urls,omitempty"`
	Genre             string            `json:"genre"`
	ID                string            `json:"id"`
	Title             string            `json:"title"`
	Body              string            `json:"body,omitempty"`
	Preview           string            `json:"preview"`
	Excerpt           string            `json:"excerpt"`
	Source            string            `json:"source,omitempty"`
	Status            string            `json:"status,omitempty"`
	CreatedAt         string            `json:"created_at"`
	UpdatedAt         string            `json:"updated_at"`
	CoverHeadline     string            `json:"cover_headline,omitempty"`
	CoverHue          string            `json:"cover_hue,omitempty"`
	Tags              []string          `json:"tags"`
	// CSSClasses —— wiki's per-note presentation classes. The owner surface used to never send
	// this back, while **the visitor side depends on it** (`WikiReaderClient` renders by it) —
	// so the regression of "edit the body once, and this silently gets cleared" only showed up
	// on visitor screens; the owner side saw nothing wrong (F-L-57's third box).
	CSSClasses    []string `json:"css_classes,omitempty"`
	SourceRawIDs  []string `json:"source_raw_ids"`
	SourceWikiIDs []string `json:"source_wiki_ids"`
	Outbound      []refOut `json:"outbound,omitempty"`
	Backlinks     []refOut `json:"backlinks,omitempty"`
	// Assets — images / attachments hung on this entry. They belong to the article;
	// visibility is inherited from it.
	Assets       []usecase.AssetView `json:"assets,omitempty"`
	ShowAsSource bool                `json:"show_as_source"`
	Published    bool                `json:"published"`
	HasChildren  bool                `json:"has_children,omitempty"`
	// FlaggedPrivate —— raw's "don't let this one out" flag. **No read endpoint used to send
	// it back at all**: the admin panel couldn't get it (`RawAdminViewSchema` defaulted it to
	// `false`, so every entry displayed as not-private), and the owner's AI couldn't get it
	// either — so there was no self-rescue path of "read it back and resend it unchanged"
	// (F-L-57). A field you can set but never read back is a switch with no receipt.
	FlaggedPrivate bool `json:"flagged_private"`
}

// refOut —— an edge between notes (read-next / who links here).
type refOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type corpusListArgs struct {
	Genre string `json:"genre"`
	Limit int32  `json:"limit"`
}

func decodeCorpusList(raw json.RawMessage) (corpusListArgs, error) {
	var in corpusListArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	// The read ops accept four genres — list and get are two granularities of the same
	// thing; if one accepted subjectivity and the other didn't, the panel could fetch a
	// single entry but never list it.
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	in.Limit = clampCorpusLimit(in.Limit)
	return in, nil
}

// clampCorpusLimit —— unset / invalid → the default window; the upper bound is fixed.
func clampCorpusLimit(n int32) int32 {
	if n <= 0 {
		return defaultCorpusLimit
	}
	if n > maxCorpusLimit {
		return maxCorpusLimit
	}
	return n
}

func listCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusList(raw)
		if perr != nil {
			return nil, perr
		}
		items, err := listByGenre(ctx, deps, ownerID, in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(items)
	}
}

func listByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusListArgs,
) ([]corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		return listRawItems(ctx, deps, ownerID, in.Limit)
	case genreWiki:
		return listWikiItems(ctx, deps, ownerID, in.Limit)
	case genreSubjectivity:
		return listSubjectivityItems(ctx, deps, ownerID, in.Limit)
	default:
		return listOutputItems(ctx, deps, ownerID, in.Limit)
	}
}

type corpusGetArgs struct {
	Genre string `json:"genre"`
	ID    string `json:"id"`
}

func decodeCorpusGet(raw json.RawMessage) (corpusGetArgs, error) {
	var in corpusGetArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

func getCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusGet(raw)
		if perr != nil {
			return nil, perr
		}
		item, err := getByGenre(ctx, deps, ownerID, in)
		if err != nil {
			return nil, corpusErr(err)
		}
		// Edges (read-next / backlinks) are supplementary: if they can't be fetched, treat
		// it as none — that shouldn't block the whole detail view from opening.
		refs := noteRefsOf(ctx, deps, ownerID, in.ID)
		item.Outbound, item.Backlinks = refs.Outbound, refs.Backlinks
		fillMedia(ctx, deps, ownerID, in.ID, &item)
		return json.Marshal(item)
	}
}

// fillMedia —— fill this entry's hero and assets into the output.
//
// If it can't be fetched, treat it as none: one broken asset shouldn't stop the whole entry
// from being readable — same reasoning as the edges above.
func fillMedia(
	ctx context.Context, deps usecase.Deps, ownerID, noteID string, item *corpusItemOut,
) {
	media, ok := usecase.LoadNoteMedia(ctx, deps.Media, ownerID, noteID)
	if !ok {
		return
	}
	item.CoverHeadline, item.CoverHue = media.Hero.CoverHeadline, media.Hero.CoverHue
	if media.Hero.CoverAssetID != "" {
		cover := media.Hero.CoverAssetID
		item.CoverImageAssetID = &cover
	}
	item.AssetURLs, item.Assets = media.URLs, media.Assets
}

func getByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusGetArgs,
) (corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		return getRawItem(ctx, deps, ownerID, in.ID)
	case genreWiki:
		return getWikiItem(ctx, deps, ownerID, in.ID)
	case genreSubjectivity:
		return getSubjectivityItem(ctx, deps, ownerID, in.ID)
	default:
		return getOutputItem(ctx, deps, ownerID, in.ID)
	}
}

// noteRefsPair —— the two sides of a note's edges.
type noteRefsPair struct {
	Outbound  []refOut
	Backlinks []refOut
}

func noteRefsOf(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) noteRefsPair {
	out, oerr := deps.NoteRefs.AdminOutboundFor(ctx, ownerID, id)
	back, berr := deps.NoteRefs.AdminBacklinksFor(ctx, ownerID, id)
	if oerr != nil || berr != nil {
		return noteRefsPair{Outbound: []refOut{}, Backlinks: []refOut{}}
	}
	return noteRefsPair{Outbound: toRefOuts(out), Backlinks: toRefOuts(back)}
}

// nonNilStrings —— a nil slice marshals to null; callers want [].
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func toRefOuts(refs []repo.NoteRef) []refOut {
	out := make([]refOut, 0, len(refs))
	for i := range refs {
		out = append(out, refOut{ID: refs[i].ID, Title: refs[i].Title})
	}
	return out
}

// corpusErr —— domain sentinel → protocol-agnostic category. The code strings are an already
// shipped contract, so each one is pinned explicitly.
func corpusErr(err error) error {
	for _, c := range corpusErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("corpus op", err)
}

// The codes are all **already shipped** (the panel branches on raw_not_found /
// sibling_name_taken), so each one is pinned individually — before normalization, MCP just
// returned one blanket "corpus entry not found", which was the worse version.
var corpusErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return fp.BadInput("required field is empty") }},
	{entity.ErrParentNotFound, func() error { return fp.BadInput("parent entry not found") }},
	{entity.ErrParentCycle, func() error { return fp.BadInput("parent would create a cycle") }},
	{entity.ErrSiblingSlugTaken, func() error {
		return fp.Coded(
			fp.Conflict("an entry with the same name already exists here"), "sibling_name_taken")
	}},
	{entity.ErrRawNotFound, func() error {
		return fp.Coded(fp.NotFound("raw entry not found"), "raw_not_found")
	}},
	{entity.ErrWikiNotFound, func() error {
		return fp.Coded(fp.NotFound("wiki entry not found"), "wiki_not_found")
	}},
	{entity.ErrOutputNotFound, func() error {
		return fp.Coded(fp.NotFound("output entry not found"), "output_not_found")
	}},
}

// nowRFC3339 —— outbound timestamps are uniformly UTC + RFC3339.
func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

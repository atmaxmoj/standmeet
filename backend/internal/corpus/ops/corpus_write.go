// corpus_write.go — writing the corpus: create / update / delete / promote
// (declared in corpus.go).
//
// genre is a parameter, not three separate tool sets. Before normalization,
// these four operations had uneven coverage across the two surfaces: the
// panel could create wiki and output and could update raw; MCP only had
// raw_dump / update_wiki / update_output / delete_wiki / delete_output /
// promote_*. In other words, the owner from Claude Code **couldn't create a
// wiki entry or update a raw one** — that wasn't a design, it was a gap
// nobody filled in. Once genre became a parameter, the structure filled the
// gap automatically.
//
// Promotion is directional: raw → wiki → output. So corpus.promote's genre
// names the **source** genre.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CorpusWrites — create / update / delete / promote.
func CorpusWrites(deps usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "corpus.create",
			Description: "Create a corpus entry. genre 'raw' takes a body (a rough dump, no " +
				"title); 'wiki' and 'output' take a title plus body, and their address is " +
				"derived from the title and the tree — never set by hand.",
			InputSchema: corpusCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createCorpus(deps),
		},
		{
			ID: "corpus.update",
			Description: "Update a corpus entry in place: body, tags, title, parent, and the " +
				"show_as_source switch. Omitted fields are replaced, so send the whole entry — " +
				"except parent_id and the cover_* fields, which are left alone when omitted " +
				"(omitting a parent must not move the note, because its address is its parent).",
			InputSchema: corpusUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateCorpus(deps),
		},
		{
			ID: "corpus.delete",
			Description: "Delete a corpus entry of any genre (raw / wiki / output / " +
				"subjectivity), along with the files attached to it. This cannot be undone.",
			InputSchema: corpusGetSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteCorpus(deps),
		},
		{
			ID: "corpus.promote",
			Description: "Promote an entry one step along raw → wiki → output: genre names the " +
				"SOURCE. The new entry records where it came from, and inherits the source's " +
				"tags on top of any given here.",
			InputSchema: corpusPromoteSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      promoteCorpus(deps),
		},
	}
}

var (
	corpusCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
			"title":{"type":"string","description":"Title (raw has none)."},
			"body":{"type":"string","description":"Markdown body."},
			"parent_id":{"type":"string","description":"Parent entry id; root if empty."},
			"tags":{"type":"array","items":{"type":"string"},"description":"Tags."},
			"source":{"type":"string",
				"description":"raw only: where it came from (e.g. mcp:claude-desktop)."},
			"flagged_private":{"type":"boolean","description":"raw only: private hint."}
		},
		"required":["genre","body"]
	}`)

	corpusUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
			"id":{"type":"string","description":"Entry id."},
			"title":{"type":"string","description":"Title (wiki / output)."},
			"body":{"type":"string","description":"Markdown body."},
			"parent_id":{"type":"string",
				"description":"Parent id. OMIT to leave it put; '' moves it to the root."},
			"tags":{"type":"array","items":{"type":"string"},"description":"Tags."},
			"css_classes":{"type":"array","items":{"type":"string"},
				"description":"wiki only: per-note presentation classes."},
			"show_as_source":{"type":"boolean",
				"description":"false = the AI may read it but never cites it."},
			"flagged_private":{"type":"boolean","description":"raw only: private hint."},
			"cover_image_asset_id":{"type":"string",
				"description":"Hero image: an asset_id from assets.upload; '' clears it."},
			"cover_headline":{"type":"string","description":"The line laid over the hero image."},
			"cover_hue":{"type":"string","description":"Hero hue: 'amber' | 'violet' | 'acid'."}
		},
		"required":["genre","id"]
	}`)

	corpusPromoteSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"SOURCE genre: 'raw' (→ wiki) or 'wiki' (→ output)."},
			"id":{"type":"string","description":"Source entry id."},
			"title":{"type":"string","description":"Title of the new entry."},
			"parent_id":{"type":"string","description":"Parent for the new entry; root if empty."},
			"tags":{"type":"array","items":{"type":"string"},
				"description":"Extra tags on top of the source's."},
			"show_as_source":{"type":"boolean",
				"description":"false = readable by the AI but never cited. Default true."}
		},
		"required":["genre","id","title"]
	}`)
)

// The input shape, plus what "omitted" means for each field, lives in
// corpus_write_args.go.

// defaultSource — record "mcp" when raw doesn't say where it came from (it
// overwhelmingly comes from the owner's AI client); the panel's path already
// sends "admin" of its own accord.
func defaultSource(s string) string {
	if s == "" {
		return "mcp"
	}
	return s
}

func createCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		// Don't persist a broken multilingual structure: the symptom on the
		// reader's side is "half the article is missing", with no hint why.
		if gerr := guardI18n(in.Body); gerr != nil {
			return nil, gerr
		}
		item, err := createByGenre(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(item)
	}
}

func createByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		row, err := usecase.RawDump(ctx, deps, &usecase.RawDumpInput{
			OwnerID: ownerID, Body: in.Body, Source: defaultSource(in.Source),
			Tags: in.Tags, FlaggedPrivate: in.flaggedPrivate(),
		})
		return rawItem(&row, ""), err
	case genreSubjectivity:
		return writeSubjectivityEntry(ctx, deps, ownerID, in, parentOrNil(in.ParentID))
	case genreWiki:
		row, err := usecase.CreateWiki(ctx, deps, &usecase.CreateWikiReq{
			OwnerID: ownerID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
			ShowAsSource: in.ShowAsSource,
		})
		return wikiItem(&row, ""), err
	default:
		row, err := usecase.CreateOutput(ctx, deps, &usecase.CreateOutputReq{
			OwnerID: ownerID, ParentID: parentOrNil(in.ParentID),
			Title: in.Title, Body: in.Body, Tags: in.Tags,
			ShowAsSource: in.ShowAsSource,
		})
		return outputItem(&row, ""), err
	}
}

// checkUpdatable — two checks before updating an entry: the required id, and
// the body's multilingual structure.
func checkUpdatable(in *corpusWriteArgs) error {
	if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
		return err
	}
	return guardI18n(in.Body)
}

func updateCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusWrite(raw)
		if perr != nil {
			return nil, perr
		}
		if err := checkUpdatable(&in); err != nil {
			return nil, err
		}
		item, err := applyCorpusUpdate(ctx, deps, ownerID, &in)
		if err != nil {
			return nil, corpusErr(err)
		}
		fillMedia(ctx, deps, ownerID, in.ID, &item)
		return json.Marshal(item)
	}
}

// writeSubjectivityEntry — the fourth genre on corpus.create /
// corpus.update.
//
// Create and update are **the same call** (WriteSubjectivity: giving an id
// means update), so both dispatch sites route here.
//
// Why not have the panel call subjectivity_write instead: the panel posts to
// `/corpus/{genre}`, with genre as a parameter. Making it hit a different
// endpoint for subjectivity would mean every corpus component has to know
// about a special case — and when this genre was added, the point was
// explicitly "it's not a special case, it's just the fifth genre".
// subjectivity_write's name stays: the owner's AI already uses it (CLAUDE.md
// says so too), and both paths call the same use case.
func writeSubjectivityEntry(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs, parent *string,
) (corpusItemOut, error) {
	res, err := usecase.WriteSubjectivity(ctx, deps, &usecase.WriteSubjectivityInput{
		OwnerID: ownerID, ID: in.ID, Title: in.Title, Body: in.Body,
		Tags: in.Tags, CSSClasses: in.CSSClasses,
		ParentID:     parent,
		ShowAsSource: in.showAsSource(),
	})
	if err != nil {
		return corpusItemOut{}, err
	}
	return getSubjectivityItem(ctx, deps, ownerID, res.ID)
}

func updateByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	if in.Genre == genreRaw {
		flagged, ferr := keptFlaggedPrivate(ctx, deps, ownerID, in)
		if ferr != nil {
			return corpusItemOut{}, ferr
		}
		tags, terr := keptTags(ctx, deps, ownerID, in)
		if terr != nil {
			return corpusItemOut{}, terr
		}
		row, err := usecase.UpdateRaw(ctx, deps, &usecase.UpdateRawReq{
			OwnerID: ownerID, ID: in.ID, Body: in.Body,
			Tags: tags, FlaggedPrivate: flagged,
		})
		return rawItem(&row, ""), err
	}
	// raw has no parent (it doesn't form a tree); the other three genres all
	// need "omitted means leave alone" resolved to a concrete parent first.
	parent, err := keptParentID(ctx, deps, ownerID, in)
	if err != nil {
		return corpusItemOut{}, err
	}
	return updateTreeGenre(ctx, deps, ownerID, in, parent)
}

func updateTreeGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs, parent *string,
) (corpusItemOut, error) {
	if in.Genre == genreSubjectivity {
		return writeSubjectivityEntry(ctx, deps, ownerID, in, parent)
	}
	// tags / css_classes also go through "omitted means leave alone" — for
	// all three genres together now, not just whichever one happened to hit
	// this path.
	tags, terr := keptTags(ctx, deps, ownerID, in)
	if terr != nil {
		return corpusItemOut{}, terr
	}
	if in.Genre == genreWiki {
		classes, cerr := keptCSSClasses(ctx, deps, ownerID, in)
		if cerr != nil {
			return corpusItemOut{}, cerr
		}
		row, err := usecase.UpdateWiki(ctx, deps, &usecase.UpdateWikiReq{
			OwnerID: ownerID, ID: in.ID, ParentID: parent,
			Title: in.Title, Body: in.Body, Tags: tags,
			ShowAsSource: in.showAsSource(), CSSClasses: classes,
		})
		return wikiItem(&row, ""), err
	}
	row, err := usecase.UpdateOutput(ctx, deps, &usecase.UpdateOutputReq{
		OwnerID: ownerID, ID: in.ID, ParentID: parent,
		Title: in.Title, Body: in.Body, Tags: tags,
		ShowAsSource: in.showAsSource(),
	})
	return outputItem(&row, ""), err
}

// deletedOut — the receipt for a delete.
type deletedOut struct {
	Genre   string `json:"genre"`
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

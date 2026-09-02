// corpus_search.go —— the owner side's "find an entry by its content".
//
// Why it has to exist (F-L-39/40/41): the owner's corpus holds 575 wiki entries + 450 raw
// entries, and this side used to have only two read ops — `corpus.list` (the newest page, capped
// at 200, **no offset**) and `corpus.get` (which requires already knowing the id). So "open my
// good-regulator-theorem note" was impossible from the owner's AI client, and on `/admin/wiki`
// the only tools were a tag filter plus eyeballing a two-column grid.
//
// Meanwhile **the visitor side has always had search** (the answer header prints
// `SEARCHED 2 · READ 2`), and the full-text search underneath, `repo.*.Search`, has always been
// there too. What was missing was never the capability — it was that the owner side was never
// wired to it.
//
// Semantics: full-text keyword search within one genre, returning **the same row shape** as
// `corpus.list` (plus a snippet), with offset paging — paging here isn't optional: a hit you
// can't reach is no different from not finding it.

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var corpusSearchSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"query":{"type":"string","description":"Words to look for in title and body."},
		"limit":{"type":"integer","description":"Max rows (default 50, max 200)."},
		"offset":{"type":"integer","description":"How many matches to skip — page with it."}
	},
	"required":["genre","query"]
}`)

// CorpusSearch —— its own constructor (rather than folded into CorpusReads): the read group now
// has three things, and registering them separately keeps "who provides what" visible at the
// assembly point.
func CorpusSearch(deps usecase.Deps) []fp.Op {
	return []fp.Op{{
		ID: "corpus.search",
		// The description must spell out where it misses — same reason as the visitor-side
		// `corpus_search` (F-S-2): this is a **lexical** index, and `to_tsvector('english', …)`
		// can't tokenize substrings inside a word, terms glued to punctuation, or CJK. The
		// owner's vault carries whole Chinese passages under the `> [!i18n]` convention, so
		// this isn't an edge case. An empty result does **not** mean the material isn't in the
		// corpus — and it's the owner's AI reading this line, deciding from it whether to
		// retry with a different word.
		Description: "Find corpus entries by what they say. Full-text over title + body " +
			"inside one genre, with offset paging. Use this when you know roughly what a note " +
			"says but not its id — corpus.list only shows the newest page. This is a lexical " +
			"index: substrings inside a word, terms glued to punctuation, and CJK tokenize " +
			"badly, so an empty result does NOT mean the corpus lacks the material — retry " +
			"with a distinctive whole word before concluding it isn't there.",
		InputSchema: corpusSearchSchema,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      searchCorpus(deps),
	}}
}

type corpusSearchArgs struct {
	Genre  string `json:"genre"`
	Query  string `json:"query"`
	Limit  int32  `json:"limit"`
	Offset int32  `json:"offset"`
}

func decodeCorpusSearch(raw json.RawMessage) (corpusSearchArgs, error) {
	var in corpusSearchArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	if err := fp.RequireArgs([2]string{"query", in.Query}); err != nil {
		return in, err
	}
	in.Limit = clampCorpusLimit(in.Limit)
	if in.Offset < 0 {
		in.Offset = 0
	}
	return in, nil
}

func searchCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusSearch(raw)
		if perr != nil {
			return nil, perr
		}
		items, err := searchByGenre(ctx, deps, ownerID, in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(items)
	}
}

func searchByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		return searchRawItems(ctx, deps, ownerID, in)
	case genreWiki:
		return searchWikiItems(ctx, deps, ownerID, in)
	case genreSubjectivity:
		return searchSubjectivityItems(ctx, deps, ownerID, in)
	default:
		return searchOutputItems(ctx, deps, ownerID, in)
	}
}

func searchRawItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Raw.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search raw: %w", err)
	}
	return noteMetaItems(rows, genreRaw), nil
}

func searchWikiItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Wiki.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search wiki: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, wikiMetaItem(&rows[i]))
	}
	return out, nil
}

func searchOutputItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Output.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search output: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, outputMetaItem(&rows[i]))
	}
	return out, nil
}

func searchSubjectivityItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Subjectivity.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search subjectivity: %w", err)
	}
	return noteMetaItems(rows, genreSubjectivity), nil
}

func noteMetaItems(rows []repo.NoteMeta, genre string) []corpusItemOut {
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, noteMetaItem(&rows[i], genre))
	}
	return out
}

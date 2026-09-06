// seo.go —— set_entry_seo: publish/unpublish one corpus entry (wiki | output) and set its excerpt.
//
// The owner-wide SEO settings (site title / robots / og template) were removed — SEO follows each
// microsite now, not a global settings section. Only this per-entry op remains here.
//
// Why it lives in owner rather than corpus: the other half of publishing a wiki entry is the
// homepage — unpublishing has to strip it from whatever section pins it too
// (pinned ⊆ published), and that's the owner's page. A cross-domain resource is declared by
// **whichever domain can import the other side** (owner → corpus is the existing direction),
// so this avoids building a new port plus an assembly-root wiring just to move the call.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// An entry's two genres — every face uses the same vocabulary.
const (
	seoGenreWiki   = "wiki"
	seoGenreOutput = "output"
)

// SEODeps —— the per-entry publish op lives in corpus; unpinning on unpublish lives in this domain.
//
// Corpus exists here for one reason: publishing/unpublishing **changes that note**, so the
// write has to refresh its search index afterward. The index's `published` field is the
// admission test for the public identity (F-D-7); a stale index leaves a just-published note
// missing from search, and a just-unpublished note still findable.
type SEODeps struct {
	SEO    *corpus.SEORepo
	Corpus corpus.Deps
}

// SEO —— set_entry_seo (the only remaining seo op after the global settings were removed).
//
// Takes *SEODeps: this deps struct carries corpus.Deps (publishing needs to refresh the index),
// and passing it by value would get flagged by gocritic as hugeParam.
func SEO(d *SEODeps) []fp.Op {
	return []fp.Op{
		{
			ID: "seo.set_entry_seo",
			Description: "Publish or unpublish one corpus entry and set its excerpt. The " +
				"public URL is derived from the title and the tree, never set by hand. " +
				"Unpublishing a pinned wiki entry also unpins it, and says which sections.",
			InputSchema: seoEntrySchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setEntrySEO(d),
		},
	}
}

var seoEntrySchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string","description":"wiki | output."},
			"id":{"type":"string","description":"Corpus entry id."},
			"excerpt":{"type":"string","description":"Meta description / card summary."},
			"published":{"type":"boolean","description":"Whether it is publicly readable."}
		},
		"required":["genre","id"]
	}`)

// seoEntryOut —— the set_entry_seo outbound payload (same for every face).
type seoEntryOut struct {
	ID      string `json:"id"`
	Genre   string `json:"genre"`
	Excerpt string `json:"excerpt"`
	// UnpinnedSections —— homepage sections automatically unpinned on unpublish (empty =
	// it wasn't pinned to begin with).
	UnpinnedSections []string `json:"unpinned_sections"`
	Published        bool     `json:"published"`
}

type seoEntryArgs struct {
	Genre     string `json:"genre"`
	ID        string `json:"id"`
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

// setEntrySEO —— genre decides which path: wiki has to unpin along with it, output never
// appears on the homepage.
func setEntrySEO(d *SEODeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSEOEntry(raw)
		if perr != nil {
			return nil, perr
		}
		if in.Genre == seoGenreWiki {
			return setWikiSEO(ctx, d, ownerID, in)
		}
		return setOutputSEO(ctx, d, ownerID, in)
	}
}

func decodeSEOEntry(raw json.RawMessage) (seoEntryArgs, error) {
	var in seoEntryArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
		return in, err
	}
	if in.Genre != seoGenreWiki && in.Genre != seoGenreOutput {
		return in, fp.BadInput("genre must be wiki or output")
	}
	return in, nil
}

func setWikiSEO(
	ctx context.Context, d *SEODeps, ownerID string, in seoEntryArgs,
) (json.RawMessage, error) {
	updated, err := d.SEO.UpdateWikiSEO(ctx, ownerID, in.ID, in.Excerpt, in.Published)
	if err != nil {
		return nil, seoErr(err)
	}
	// Publish state changed → this note's search document has to change with it
	// (see SEODeps.Corpus).
	corpus.ReindexCorpusNote(ctx, d.Corpus, ownerID, in.ID)
	return json.Marshal(seoEntryOut{
		ID: updated.ID(), Genre: in.Genre, Excerpt: updated.Excerpt(),
		Published: updated.Published(), UnpinnedSections: []string{},
	})
}

func setOutputSEO(
	ctx context.Context, d *SEODeps, ownerID string, in seoEntryArgs,
) (json.RawMessage, error) {
	updated, err := d.SEO.UpdateOutputSEO(ctx, ownerID, in.ID, in.Excerpt, in.Published)
	if err != nil {
		return nil, seoErr(err)
	}
	corpus.ReindexCorpusNote(ctx, d.Corpus, ownerID, in.ID)
	return json.Marshal(seoEntryOut{
		ID: updated.ID(), Genre: in.Genre, Excerpt: updated.Excerpt(),
		Published: updated.Published(), UnpinnedSections: []string{},
	})
}

// seoErr —— domain sentinels → protocol-agnostic categories. code is an already-published
// contract, pinned down explicitly.
func seoErr(err error) error {
	for _, c := range seoErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("seo op", err)
}

var seoErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{corpus.ErrWikiNotFound, func() error {
		return fp.Coded(fp.NotFound("wiki entry not found"), "wiki_not_found")
	}},
	{corpus.ErrOutputNotFound, func() error {
		return fp.Coded(fp.NotFound("output entry not found"), "output_not_found")
	}},
}

// seo.go —— the seo resource: the face of this instance that search engines and share cards
// see.
//
// Three things: owner-wide settings (site title / robots / sitemap extras / OG template),
// per-genre counts of published entries, and **one entry's** publish switch and excerpt.
//
// Why it lives in owner rather than corpus: the other half of publishing a wiki entry is the
// homepage — unpublishing has to strip it from whatever section pins it too
// (pinned ⊆ published), and that's the owner's page. A cross-domain resource is declared by
// **whichever domain can import the other side** (owner → corpus is the existing direction),
// so this avoids building a new port plus an assembly-root wiring just to move the call.
//
// Three inconsistencies collapsed during normalization:
//
//   - seo.update_settings coming from MCP used to **wipe out site_title**: that upsert
//     overwrites the whole row, and MCP's argument never carried site_title at all. A
//     three-state argument plus a merge in the domain gives every face the same rule now.
//   - The panel long ago collapsed wiki / output into one route (genre goes in the path),
//     while MCP still had two tools. It's the same operation, only which genre an entry
//     belongs to differs — one op, genre is a parameter.
//   - An entry's primary key in the outbound payload: the panel called it id, MCP called it
//     wiki_id/output_id. One payload, called id.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// An entry's two genres — every face uses the same vocabulary.
const (
	seoGenreWiki   = "wiki"
	seoGenreOutput = "output"
)

// SEODeps —— settings/counts/entries live in corpus, unpinning on unpublish lives in this
// domain.
//
// Corpus exists here for one reason: publishing/unpublishing **changes that note**, so the
// write has to refresh its search index afterward. The index's `published` field is the
// admission test for the public identity (F-D-7); a stale index leaves a just-published note
// missing from search, and a just-unpublished note still findable.
type SEODeps struct {
	SEO    *corpus.SEORepo
	Pins   usecase.PagePinDeps
	Corpus corpus.Deps
}

// SEO —— get_settings / update_settings / stats / set_entry_seo.
//
// Takes *SEODeps: this deps struct now carries corpus.Deps (publishing needs to refresh the
// index), and passing it by value would get flagged by gocritic as hugeParam.
func SEO(d *SEODeps) []fp.Op {
	return []fp.Op{
		{
			ID: "seo.get_settings",
			Description: "Read the owner-wide public-facing settings: site title, robots " +
				"indexing switch, extra sitemap URLs and the OG title template.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getSEOSettings(d.SEO),
		},
		{
			ID: "seo.update_settings",
			Description: "Change owner-wide public-facing settings. Omitted fields keep " +
				"their current value.",
			InputSchema: seoSettingsSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateSEOSettings(d.SEO),
		},
		{
			ID:          "seo.stats",
			Description: "Count the published entries per genre (wiki, outputs, writings).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      seoStats(d.SEO),
		},
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

var (
	seoSettingsSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"site_title":{"type":"string","description":"Owner-written site title."},
			"index_robots":{"type":"boolean",
				"description":"Whether robots may index this instance."},
			"sitemap_extras":{"type":"array","items":{"type":"string"},
				"description":"Extra URLs to list in the sitemap."},
			"og_template":{"type":"string","description":"OG title template."}
		}
	}`)

	seoEntrySchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string","description":"wiki | output."},
			"id":{"type":"string","description":"Corpus entry id."},
			"excerpt":{"type":"string","description":"Meta description / card summary."},
			"published":{"type":"boolean","description":"Whether it is publicly readable."}
		},
		"required":["genre","id"]
	}`)
)

// seoSettingsOut / seoStatsOut / seoEntryOut —— outbound payloads (same for every face).
type seoSettingsOut struct {
	SiteTitle     string   `json:"site_title"`
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

type seoStatsOut struct {
	Wiki     int64 `json:"wiki"`
	Outputs  int64 `json:"outputs"`
	Writings int64 `json:"writings"`
}

type seoEntryOut struct {
	ID      string `json:"id"`
	Genre   string `json:"genre"`
	Excerpt string `json:"excerpt"`
	// UnpinnedSections —— homepage sections automatically unpinned on unpublish (empty =
	// it wasn't pinned to begin with).
	UnpinnedSections []string `json:"unpinned_sections"`
	Published        bool     `json:"published"`
}

func toSEOSettingsOut(s *corpus.SEOSettings) seoSettingsOut {
	return seoSettingsOut{
		SiteTitle: s.SiteTitle, OGTemplate: s.OGTemplate,
		SitemapExtras: nonNilStrings(s.SitemapExtras), IndexRobots: s.IndexRobots,
	}
}

func getSEOSettings(seo *corpus.SEORepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		s, err := seo.GetSettings(ctx, ownerID)
		if err != nil {
			return nil, seoErr(err)
		}
		return json.Marshal(toSEOSettingsOut(&s))
	}
}

type seoSettingsArgs struct {
	SiteTitle     fp.OptionalString  `json:"site_title"`
	OGTemplate    fp.OptionalString  `json:"og_template"`
	SitemapExtras fp.OptionalStrings `json:"sitemap_extras"`
	IndexRobots   fp.OptionalBool    `json:"index_robots"`
}

func updateSEOSettings(seo *corpus.SEORepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSEOSettings(raw)
		if perr != nil {
			return nil, perr
		}
		saved, err := corpus.PatchSEOSettings(ctx, seo, &corpus.SEOSettingsPatch{
			OwnerID:       ownerID,
			SiteTitle:     corpus.OptionalText{Value: in.SiteTitle.Value, Set: in.SiteTitle.Set},
			OGTemplate:    corpus.OptionalText{Value: in.OGTemplate.Value, Set: in.OGTemplate.Set},
			SitemapExtras: corpus.OptionalTextList(in.SitemapExtras),
			IndexRobots:   corpus.OptionalFlag(in.IndexRobots),
		})
		if err != nil {
			return nil, seoErr(err)
		}
		return json.Marshal(toSEOSettingsOut(&saved))
	}
}

// decodeSEOSettings —— every field is optional: an empty body = change nothing.
func decodeSEOSettings(raw json.RawMessage) (seoSettingsArgs, error) {
	var in seoSettingsArgs
	if len(raw) == 0 {
		return in, nil
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func seoStats(seo *corpus.SEORepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		counts, err := seo.CountPublished(ctx, ownerID)
		if err != nil {
			return nil, seoErr(err)
		}
		return json.Marshal(seoStatsOut{
			Wiki: counts.Wiki, Outputs: counts.Outputs, Writings: counts.Writings,
		})
	}
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
	res, err := usecase.UpdateWikiSEOWithPins(ctx, d.SEO, d.Pins, usecase.WikiSEOUpdate{
		OwnerID: ownerID, WikiID: in.ID,
		Description: in.Excerpt, Published: in.Published,
	})
	if err != nil {
		return nil, seoErr(err)
	}
	// Publish state changed → this note's search document has to change with it
	// (see SEODeps.Corpus).
	corpus.ReindexCorpusNote(ctx, d.Corpus, ownerID, in.ID)
	return json.Marshal(seoEntryOut{
		ID: res.Wiki.ID(), Genre: in.Genre, Excerpt: res.Wiki.Excerpt(),
		Published: res.Wiki.Published(), UnpinnedSections: nonNilStrings(res.Unpinned),
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

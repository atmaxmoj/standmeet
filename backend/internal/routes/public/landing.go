// landing.go —— #114 public corpus landing/reader rendering (split out of the original
// seo.go). GET /wiki/* + /output/* — single-owner instance, URL carries no handle, a chi
// wildcard lets path contain `/` (group/section). Owner doesn't exist / slug doesn't
// exist / not public all → 404. robots.txt + sitemap.xml are real SEO and stay in
// seo.go. Handler methods hang off SEOHandlers (sharing Deps); fully normalizing the
// SEO→landing naming is left for a later pass.

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

func (h *SEOHandlers) getWikiLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		// F-L-11 bearer-aware reader: a valid code bearer reads in-scope gated entries; anonymous
		// (no/dead token) → published-only (SEO). Same scope predicate the wiki-tree/context use.
		token, _ := bearerToken(r)
		scope := owner.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		// ?lang= —— which language the visitor wants. **A query parameter, not a path
		// segment**: not every note carries the same set of languages, and a
		// `/zh/...`-style path would break on an entry with no Chinese version.
		view, err := loadWikiLandingView(
			r.Context(), h.Deps, slug, scope, r.URL.Query().Get("lang"))
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONWikiLanding(h.Log, w, &view)
	}
}

type wikiRefView struct {
	Title string `json:"title"`
	Path  string `json:"path"`
}

// wikiLandingView —— field order follows pointer width (map → string → slice →
// scalar), enforced by govet fieldalignment; read it by json tag, don't infer semantic
// grouping from line order.
type wikiLandingView struct {
	// AssetURLs —— maps `standmeet-asset:<id>` references in the body + the hero image
	// to reachable URLs. The reader swaps URIs for URLs against this table before
	// rendering; without it, the visitor sees a URI that won't render.
	AssetURLs map[string]string `json:"asset_urls"`
	Path      string            `json:"path"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Excerpt   string            `json:"excerpt"`
	UpdatedAt string            `json:"updated_at"`
	// hero section —— cover image + the line laid over it + hue. An empty
	// CoverImageAssetID = the owner never set a cover, and the reader falls back to a
	// procedurally generated color swatch.
	CoverImageAssetID string   `json:"cover_image_asset_id"`
	CoverHeadline     string   `json:"cover_headline"`
	CoverHue          string   `json:"cover_hue"`
	Tags              []string `json:"tags"`
	// CSSClasses —— per-note presentation hooks; added to .corpus-content.
	CSSClasses []string      `json:"css_classes"`
	Related    []wikiRefView `json:"related"`
	CitedBy    []wikiRefView `json:"cited_by"`
	// Assets —— the files attached to this entry (filename + real byte count + URL).
	// The reader uses it to render the downloads section. **Never null**: an empty
	// array means "no attachments", a null would be read as "this field is broken".
	Assets []wikiAssetView `json:"assets"`
	// Lang / Languages —— which language this body is in, and which languages this
	// note offers (used by the switcher). A single-language note: lang empty,
	// languages an empty array.
	Lang      string         `json:"lang"`
	Languages []languageView `json:"languages"`
	// SourcesCount —— how many raw entries this wiki entry was distilled from
	// (N corpus sources).
	SourcesCount int `json:"sources_count"`
}

// wikiAssetView —— what one attachment looks like from the visitor's side. **No
// storage key, no holder id**: the visitor needs "what it's called, how big, where to
// download from" — nothing else belongs on this wire.
type wikiAssetView struct {
	AssetID     string `json:"asset_id"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	Filename    string `json:"original_filename"`
	URL         string `json:"url"`
	SizeBytes   int64  `json:"size_bytes"`
}

func toWikiAssetViews(assets []corpus.AssetView) []wikiAssetView {
	out := make([]wikiAssetView, 0, len(assets))
	for i := range assets {
		out = append(out, wikiAssetView{
			AssetID: assets[i].AssetID, Kind: assets[i].Kind,
			ContentType: assets[i].ContentType, Filename: assets[i].Filename,
			URL: assets[i].URL, SizeBytes: assets[i].SizeBytes,
		})
	}
	return out
}

// nonNilURLs —— a nil map serializes to null, but callers need {}.
func nonNilURLs(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

func loadWikiLandingView(
	ctx context.Context, deps owner.SEODeps, slug string, scope owner.WikiTreeScope, lang string,
) (wikiLandingView, error) {
	res, err := owner.GetWikiLandingInLang(ctx, deps, slug, scope, lang)
	if err != nil {
		return wikiLandingView{}, err
	}
	return wikiLandingView{
		Path:              slug,
		Title:             res.Wiki.Title(),
		Body:              res.Body,
		AssetURLs:         nonNilURLs(res.AssetURLs),
		Excerpt:           res.Wiki.Excerpt(),
		UpdatedAt:         res.Wiki.UpdatedAt().UTC().Format(time.RFC3339),
		Tags:              res.Wiki.Tags(),
		CSSClasses:        res.Wiki.CSSClasses(),
		Related:           toWikiRefViews(res.Related),
		CitedBy:           toWikiRefViews(res.CitedBy),
		Assets:            toWikiAssetViews(res.Assets),
		CoverImageAssetID: res.Hero.CoverAssetID,
		CoverHeadline:     res.Hero.CoverHeadline,
		CoverHue:          res.Hero.CoverHue,
		SourcesCount:      len(res.Wiki.SourceRawIDs()),
		Lang:              res.I18n.Lang,
		Languages:         toLanguageViews(&res.I18n),
	}, nil
}

// languageView —— one entry on the switcher: code + display label. Label rules come
// from the vault's own lang-labels (generated from the code if not set), so the vault
// and the site show the same wording.
type languageView struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// toLanguageViews —— language set → switcher entries. **Never null**: an empty array
// means "this entry is single-language", a null would be read as "this field is
// broken".
func toLanguageViews(meta *owner.LandingI18n) []languageView {
	out := make([]languageView, 0, len(meta.Languages))
	for _, code := range meta.Languages {
		out = append(out, languageView{Code: code, Label: corpus.I18nLabel(code, meta.Labels)})
	}
	return out
}

func toWikiRefViews(refs []corpus.WikiPathTitle) []wikiRefView {
	out := make([]wikiRefView, 0, len(refs))
	for i := range refs {
		out = append(out, wikiRefView{Title: refs[i].Title, Path: refs[i].Path})
	}
	return out
}

func writeJSONWikiLanding(log *slog.Logger, w http.ResponseWriter, view *wikiLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode wiki landing", "err", err)
	}
}

func handleLandingErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyLandingErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("wiki landing", "err", err)
	}
	writeError(log, w, env)
}

// landingNotFound —— the shared not-found envelope for wiki / output.
var landingNotFound = apierr.Envelope{
	Status: http.StatusNotFound, Code: "not_found", Message: "page not found",
}

// landingNotFoundSentinels —— the set of sentinel errors treated as 404 on the landing
// path.
var landingNotFoundSentinels = []error{
	corpus.ErrWikiNotFound,
	corpus.ErrOutputNotFound,
	owner.ErrOwnerNotFound,
}

func isLandingNotFound(err error) bool {
	for _, sentinel := range landingNotFoundSentinels {
		if errors.Is(err, sentinel) {
			return true
		}
	}
	return false
}

func classifyLandingErr(err error) apierr.Envelope {
	if isLandingNotFound(err) {
		return landingNotFound
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}

func (h *SEOHandlers) getOutputLanding() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "*")
		view, err := loadOutputLandingView(r.Context(), h.Deps, slug)
		if err != nil {
			handleLandingErr(h.Log, w, err)
			return
		}
		writeJSONOutputLanding(h.Log, w, &view)
	}
}

// outputLandingView —— fields aligned with wikiLandingView, so the frontend SDK can
// reuse the rendering.
type outputLandingView struct {
	// AssetURLs —— maps `standmeet-asset:<id>` references in the body + the hero
	// image to reachable URLs. Without it, the visitor sees an empty image slot
	// (urlTransform silently strips a non-standard scheme, with no error).
	AssetURLs map[string]string `json:"asset_urls"`
	Path      string            `json:"path"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Excerpt   string            `json:"excerpt"`
	UpdatedAt string            `json:"updated_at"`
	// hero section —— cover image + the line laid over it + hue. Empty = the owner
	// never set one.
	CoverImageAssetID string          `json:"cover_image_asset_id"`
	CoverHeadline     string          `json:"cover_headline"`
	CoverHue          string          `json:"cover_hue"`
	Assets            []wikiAssetView `json:"assets"`
}

func loadOutputLandingView(
	ctx context.Context, deps owner.SEODeps, slug string,
) (outputLandingView, error) {
	res, err := owner.GetOutputLanding(ctx, deps, slug)
	if err != nil {
		return outputLandingView{}, err
	}
	out := res.Output
	return outputLandingView{
		Path:              slug,
		Title:             out.Title(),
		Body:              out.Body(),
		Excerpt:           out.Excerpt(),
		UpdatedAt:         out.UpdatedAt().UTC().Format(time.RFC3339),
		AssetURLs:         nonNilURLs(res.AssetURLs),
		Assets:            toWikiAssetViews(res.Assets),
		CoverImageAssetID: res.Hero.CoverAssetID,
		CoverHeadline:     res.Hero.CoverHeadline,
		CoverHue:          res.Hero.CoverHue,
	}, nil
}

func writeJSONOutputLanding(log *slog.Logger, w http.ResponseWriter, view *outputLandingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode output landing", "err", err)
	}
}

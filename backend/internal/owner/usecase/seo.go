// seo.go — thin business wrapper for SEO, so routes/public/seo.go doesn't import postgres
// directly. Landing URLs are path-based (replacing the old slug): /<handle>/wiki/<path>,
// path may contain `/` (frontend router uses a catch-all), reusing the retrieval ACL column.

package usecase

import (
	"context"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// SEODeps — what the SEO usecases need. Wiki/Output load the full tree and compute public
// landing addresses (pure tree derivation; doesn't read the retired path column).
type SEODeps struct {
	Owners   *repo.Repo
	SEO      *corpus.SEORepo
	Wiki     *corpus.WikiRepo
	Output   *corpus.OutputRepo
	NoteRefs *corpus.NoteRefRepo
	// Media — assets attached to this corpus entry. Any genre can have some, so the reader
	// must resolve `standmeet-asset:<id>` refs in the body into reachable addresses, or the
	// visitor sees a URI that renders as nothing. Used to travel only through the writing
	// path, so "every genre can carry images" held on the backend but not visibly.
	Media *corpus.NoteAssetsDeps
	// Vault — the two frontmatter fields multi-language rendering needs (identity language +
	// switcher labels). Nil means every note is treated as lang-unset, falling back to face 1.
	Vault *corpus.VaultSyncRepo
}

// FirstOwner — fetches the first owner, for robots/sitemap. Empty/error return (Owner{}, false).
func FirstOwner(ctx context.Context, deps SEODeps) (entity.Owner, bool) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil || handle == "" {
		return entity.Owner{}, false
	}
	soleOwner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		return entity.Owner{}, false
	}
	return soleOwner, true
}

// FirstOwnerSettings — the SEO rendering entry point: fetches the first owner's SEOSettings.
func FirstOwnerSettings(ctx context.Context, deps SEODeps) (corpus.SEOSettings, bool) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return corpus.SEOSettings{}, false
	}
	settings, err := deps.SEO.GetSettings(ctx, soleOwner.ID)
	if err != nil {
		return corpus.SEOSettings{}, false
	}
	return settings, true
}

// PublicReady — a centralized robots/sitemap readiness check.
func PublicReady(ctx context.Context, deps SEODeps) (entity.Owner, bool) {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok || soleOwner.PublicURL == "" {
		return entity.Owner{}, false
	}
	settings, ok := FirstOwnerSettings(ctx, deps)
	if !ok || !settings.IndexRobots {
		return entity.Owner{}, false
	}
	return soleOwner, true
}

// WikiLanding — the landing query result: wiki entity + rendered body (Obsidian
// `[[Title]]` rewritten into /wiki/<path> links) + outbound (Related)/inbound (CitedBy) links.
type WikiLanding struct {
	// AssetURLs — `standmeet-asset:<id>` refs in the body + the hero image, mapped to
	// reachable addresses. Rendering swaps URIs for URLs using this table.
	AssetURLs map[string]string
	Body      string
	Related   []corpus.WikiPathTitle
	CitedBy   []corpus.WikiPathTitle
	// Assets — this entry's file list (filename + byte size + address); the download button's data.
	Assets []corpus.AssetView
	// I18n — this note's multi-language view: selected face + which languages exist +
	// switcher labels. Single-language note -> Languages is empty -> no switcher shown.
	I18n LandingI18n
	// Hero — cover image / overlay line / color tone. Any genre can have one, backed by
	// the shared hero table.
	Hero corpus.NoteHero
	Wiki corpus.Wiki
}

// LandingI18n — what the reader page needs. Body is already rendered in the selected
// language (WikiLanding.Body); this only carries which was picked/exist/displays as.
type LandingI18n struct {
	Labels    map[string]string
	Lang      string
	Languages []string
}

// wikiRefSides — one wiki entry's outbound + inbound links (for the landing response).
type wikiRefSides struct {
	Related []corpus.WikiPathTitle
	CitedBy []corpus.WikiPathTitle
}

// GetWikiLanding — the public landing query: path -> wiki entry + rendered body +
// read-next/cited-by. Addresses are pure tree derivation: one full-tree load both locates
// the target entry and builds the title->path index for cross-link resolution.
// scope decides whether this viewer can read a given entry (F-L-11 bearer-aware reader):
// anonymous = PublicWikiScope (published only, for crawlers/SEO); a valid code bearer =
// RoleWikiScope (entries inside that role's corpus glob, regardless of published) — the
// access model is "published (anonymous) + code (invited scope)".
func GetWikiLanding(
	ctx context.Context, deps SEODeps, path string, scope WikiTreeScope,
) (WikiLanding, error) {
	return GetWikiLandingInLang(ctx, deps, path, scope, "")
}

// GetWikiLandingInLang — same as above, plus the language the visitor wants (`?lang=`).
func GetWikiLandingInLang(
	ctx context.Context, deps SEODeps, path string, scope WikiTreeScope, lang string,
) (WikiLanding, error) {
	if path == "" {
		return WikiLanding{}, corpus.ErrWikiNotFound
	}
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return WikiLanding{}, entity.ErrOwnerNotFound
	}
	// Full meta (no body, no 50-cap): computes tree-derived paths to locate the entry and
	// build the title index for rendering [[X]] links. A deep entry (beyond the old
	// newest-50 cap) is findable too, and links don't break; body is fetched via GetByID.
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return WikiLanding{}, fmt.Errorf("list wiki meta: %w", err)
	}
	return assembleWikiLanding(ctx, deps, soleOwner.ID,
		&landingLocate{scope: scope, path: path, metas: metas, lang: lang})
}

// landingLocate — input for locating one landing (full meta + target path + viewer
// scope). Bundled into one param so assembleWikiLanding respects argument-limit. Field
// order follows fieldalignment.
type landingLocate struct {
	scope WikiTreeScope
	path  string
	// lang — the language the visitor wants (`?lang=`); empty uses this note's identity language.
	lang  string
	metas []corpus.WikiMeta
}

func assembleWikiLanding(
	ctx context.Context, deps SEODeps, ownerID string, loc *landingLocate,
) (WikiLanding, error) {
	paths := corpus.WikiMetaTreePaths(loc.metas)
	id, found := indexedWikiIDAtPath(loc.metas, paths, loc.path, loc.scope)
	if !found {
		return WikiLanding{}, corpus.ErrWikiNotFound
	}
	w, gerr := deps.Wiki.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return WikiLanding{}, fmt.Errorf("get wiki: %w", gerr)
	}
	body := corpus.RewriteWikiCrossLinksForRender(
		w.Body(), corpus.WikiMetaPathTitleIndex(loc.metas, paths),
	)
	sides, serr := loadWikiRefSides(ctx, deps, ownerID, id, paths)
	if serr != nil {
		return WikiLanding{}, serr
	}
	media := landingMedia(ctx, deps, ownerID, id)
	view := landingI18n(ctx, deps,
		&landingNote{ownerID: ownerID, id: id, body: body, title: w.Title()}, loc.lang)
	return WikiLanding{
		Body: view.body, Related: sides.Related, CitedBy: sides.CitedBy, Wiki: w,
		AssetURLs: media.URLs, Hero: media.Hero, Assets: media.Assets, I18n: view.meta,
	}, nil
}

// landingMedia — everything media-related on this corpus entry: resolved reference
// addresses, the hero trio, the attachment list. All three come from one query together —
// splitting them used to drop hero and attachments (a cover image never reached the
// visitor page; it showed a slug-hash color block instead, and attachments had no field).
// A failure to fetch is treated as absence — one broken asset, or unwired media storage
// (some read-only compositions), shouldn't take down the whole page.
func landingMedia(
	ctx context.Context, deps SEODeps, ownerID, noteID string,
) corpus.NoteMediaView {
	media, ok := corpus.LoadNoteMedia(ctx, deps.Media, ownerID, noteID)
	if !ok {
		return corpus.NoteMediaView{URLs: map[string]string{}, Assets: []corpus.AssetView{}}
	}
	return media
}

// indexedWikiIDAtPath — from full meta + derived paths, picks the id whose path matches
// and that this viewer is allowed to see. Visibility is delegated to scope (anonymous =
// published only; code = inside the role glob), no longer hardcoded to published (F-L-11).
func indexedWikiIDAtPath(
	metas []corpus.WikiMeta, paths map[string]string, path string, scope WikiTreeScope,
) (string, bool) {
	for i := range metas {
		if paths[metas[i].ID] == path && scope(metas[i].Published, path) {
			return metas[i].ID, true
		}
	}
	return "", false
}

// loadWikiRefSides — fetches this wiki entry's outbound (OutboundFor) + inbound
// (BacklinksFor) links; each ref's id maps to (title, path) via the full-tree derived paths.
func loadWikiRefSides(
	ctx context.Context, deps SEODeps, ownerID, wikiID string, paths map[string]string,
) (wikiRefSides, error) {
	out, oerr := deps.NoteRefs.OutboundFor(ctx, wikiID)
	if oerr != nil {
		return wikiRefSides{}, fmt.Errorf("wiki outbound: %w", oerr)
	}
	back, berr := deps.NoteRefs.BacklinksFor(ctx, ownerID, wikiID)
	if berr != nil {
		return wikiRefSides{}, fmt.Errorf("wiki backlinks: %w", berr)
	}
	return wikiRefSides{
		Related: wikiRefsToPathTitle(out, paths),
		CitedBy: wikiRefsToPathTitle(back, paths),
	}, nil
}

func wikiRefsToPathTitle(refs []corpus.NoteRef, paths map[string]string) []corpus.WikiPathTitle {
	out := make([]corpus.WikiPathTitle, 0, len(refs))
	for i := range refs {
		out = append(out, corpus.WikiPathTitle{Title: refs[i].Title, Path: paths[refs[i].ID]})
	}
	return out
}

// LandingURL — the sitemap URL for one indexed landing (works for either wiki or output).
type LandingURL struct {
	Path      string
	UpdatedAt int64
}

// IndexedWikiLandings — for sitemap.xml, lists every indexed path for the owner (tree-derived).
func IndexedWikiLandings(ctx context.Context, deps SEODeps) []LandingURL {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return []LandingURL{}
	}
	paths := corpus.WikiMetaTreePaths(metas)
	out := make([]LandingURL, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			out = append(out, LandingURL{Path: paths[metas[i].ID], UpdatedAt: metas[i].UpdatedAt})
		}
	}
	return out
}

// OutputLanding — one output's landing page. Carries media just like WikiLanding: it
// used to return only a corpus.Output, so a visitor's standmeet-asset refs in the body
// wouldn't render, the cover never reached the frontend, and attachments had no field.
// The underlying mechanism was always genre-agnostic; media just wasn't carried out here.
type OutputLanding struct {
	AssetURLs map[string]string
	Assets    []corpus.AssetView
	Hero      corpus.NoteHero
	Output    corpus.Output
}

// GetOutputLanding — the public output landing query (same tree-derivation as wiki), plus media.
func GetOutputLanding(
	ctx context.Context, deps SEODeps, path string,
) (OutputLanding, error) {
	if path == "" {
		return OutputLanding{}, corpus.ErrOutputNotFound
	}
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return OutputLanding{}, entity.ErrOwnerNotFound
	}
	out, err := resolveOutputLanding(ctx, deps, soleOwner.ID, path)
	if err != nil {
		return OutputLanding{}, err
	}
	media := landingMedia(ctx, deps, soleOwner.ID, out.ID())
	return OutputLanding{
		Output: out, AssetURLs: media.URLs, Assets: media.Assets, Hero: media.Hero,
	}, nil
}

// resolveOutputLanding — locates the entry matching path in full meta, fetches via GetByID.
func resolveOutputLanding(
	ctx context.Context, deps SEODeps, ownerID, path string,
) (corpus.Output, error) {
	metas, err := deps.Output.ListAllMeta(ctx, ownerID)
	if err != nil {
		return corpus.Output{}, fmt.Errorf("list output meta: %w", err)
	}
	id, found := indexedOutputIDAtPath(metas, corpus.OutputMetaTreePaths(metas), path)
	if !found {
		return corpus.Output{}, corpus.ErrOutputNotFound
	}
	o, gerr := deps.Output.GetByID(ctx, ownerID, id)
	if gerr != nil {
		return corpus.Output{}, fmt.Errorf("get output: %w", gerr)
	}
	return o, nil
}

// indexedOutputIDAtPath — the wiki version's twin: indexed id matching path, from full meta.
func indexedOutputIDAtPath(
	metas []corpus.OutputMeta, paths map[string]string, path string,
) (string, bool) {
	for i := range metas {
		if metas[i].Published && paths[metas[i].ID] == path {
			return metas[i].ID, true
		}
	}
	return "", false
}

// IndexedOutputLandings — for sitemap.xml, lists indexed output landings (tree-derived).
func IndexedOutputLandings(ctx context.Context, deps SEODeps) []LandingURL {
	soleOwner, ok := FirstOwner(ctx, deps)
	if !ok {
		return []LandingURL{}
	}
	metas, err := deps.Output.ListAllMeta(ctx, soleOwner.ID)
	if err != nil {
		return []LandingURL{}
	}
	paths := corpus.OutputMetaTreePaths(metas)
	out := make([]LandingURL, 0, len(metas))
	for i := range metas {
		if metas[i].Published {
			out = append(out, LandingURL{Path: paths[metas[i].ID], UpdatedAt: metas[i].UpdatedAt})
		}
	}
	return out
}

// seo_i18n.go — the multi-language layer on the landing page: which language the reader
// wants, and which languages this note has.
//
// Split into its own file because it's a different concern from its neighbor's "locate
// one landing + assemble its assets/links": that one answers "which entry", this one
// answers "which face".

package usecase

import (
	"context"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// landingNote — the entry being rendered (whose, which one, body, title). Bundled into
// one param to respect the argument-limit. Title is here because **the line at the top
// of the body that repeats the title is not rendered**: the page header already prints
// it (UX-85).
type landingNote struct {
	ownerID string
	id      string
	body    string
	title   string
}

// landingRender — one landing's rendered body + its multi-language metadata.
type landingRender struct {
	body string
	meta LandingI18n
}

// landingI18n — picks a face according to the language the visitor wants. Prose
// **outside** the multi-language blocks stays as-is: a note isn't N separate documents,
// and those sentences don't belong to any one language. If the requested language isn't
// available -> falls back to the note's identity language (lang), not the first face.
func landingI18n(
	ctx context.Context, deps SEODeps, note *landingNote, want string,
) landingRender {
	identity, labels := "", map[string]string{}
	if deps.Vault != nil {
		got := deps.Vault.GetLang(ctx, note.ownerID, note.id)
		identity, labels = got.Lang, got.Labels
	}
	body := note.body
	view := corpus.I18nViewFor(body, want, identity, note.title)
	return landingRender{body: view.Body, meta: LandingI18n{
		Lang: view.Lang, Languages: view.Languages, Labels: labels,
	}}
}

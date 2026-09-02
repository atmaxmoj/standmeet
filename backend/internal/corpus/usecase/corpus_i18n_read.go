// corpus_i18n_read.go —— the multilingual layer when reading one corpus entry.
//
// **One language at a time.** Stuffing both languages into the agent's context means
// paying token cost twice per note, and the two versions would tell the same story in
// ways that contradict each other; splitting them into two separate hits would make the
// same note show up twice in search results. So this goes through the same function as
// the reader page: pick one side, leave language-neutral prose as-is.
//
// Which languages exist **must also be reported** — otherwise the agent can't "decide
// for itself" (it doesn't even know how many there are).

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
)

// langReader —— one note's identity language plus its switcher labels (pgCorpusLister
// implements this via the vault-sync repository). Best-effort: if it can't be read,
// treat it as unset and render the first side.
type langReader interface {
	NoteLang(ctx context.Context, ownerID, noteID string) (string, map[string]string)
}

// NoteLang —— implements langReader.
func (l *pgCorpusLister) NoteLang(
	ctx context.Context, ownerID, noteID string,
) (string, map[string]string) {
	if l.queryRepo == nil {
		return "", map[string]string{}
	}
	got := l.queryRepo.GetLang(ctx, ownerID, noteID)
	return got.Lang, got.Labels
}

// I18nView —— the multilingual view of one body: the selected side plus which languages
// are available.
type I18nView struct {
	Body      string
	Lang      string
	Languages []string
}

// ViewFor —— picks one side according to want. Not a multilingual note -> returned as-is,
// Languages empty (the reader page uses this to skip showing a switcher).
//
// title is the note's title: **the line at the top of the body that repeats the title is
// not emitted** (UX-85) — the page header already prints it. The criterion is an exact
// match (`i18n.StripTitleEcho`); an opening line that differs is content and is left as
// is. Handled here rather than stripped separately by each reader page: this one function
// is the shared path for the reader page, search, and the agent's context.
func ViewFor(body, want, identity, title string) I18nView {
	doc := i18n.Parse(body)
	if !doc.Multilingual() {
		return I18nView{Body: i18n.StripLeadingTitle(body, title), Languages: []string{}}
	}
	i18n.StripTitleEcho(&doc, title)
	return I18nView{
		Body:      i18n.Render(&doc, want, identity),
		Lang:      i18n.Resolve(&doc, want, identity),
		Languages: doc.Langs,
	}
}

// visitor_history_citations.go —— the id → path / title / slug lookups the conversation read model
// uses to turn a message's cited ids into DialogCitations (resolver: visitor_history.go).

package usecase

import corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

// citeMaps —— one genre's id → path / title / slug lookups (slugs: writings only, else nil).
type citeMaps struct{ paths, titles, slugs map[string]string }

func appendCites(out []DialogCitation, genre string, ids []string, m citeMaps) []DialogCitation {
	for _, id := range ids {
		path, ok := m.paths[id]
		if !ok {
			continue
		}
		out = append(out, DialogCitation{
			Genre: genre, Path: path, Title: m.titles[id], Slug: m.slugs[id],
		})
	}
	return out
}

// writingSlugMap —— a writing's public address is its slug (/writings/<slug>), not its path.
func writingSlugMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Slug()
	}
	return m
}

func wikiTitleMap(ws []corpus.Wiki) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}

func outputTitleMap(os []corpus.Output) map[string]string {
	m := make(map[string]string, len(os))
	for i := range os {
		m[os[i].ID()] = os[i].Title()
	}
	return m
}

// writingPathMap —— writing has its own slug-derived path ("writings/"+slug), no tree walk.
func writingPathMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Path()
	}
	return m
}

func writingTitleMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}

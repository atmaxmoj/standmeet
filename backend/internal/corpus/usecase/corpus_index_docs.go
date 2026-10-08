// corpus_index_docs.go —— one corpus note → its search-index chunks.
//
// A note is indexed as one document per language face per heading section:
//   - per face, so an English query is answered from English text first and the Chinese face
//     of the same note does not compete with it (search.Client.Search runs the query's language
//     first);
//   - per section, so a match deep in a long note is a hit on that section and the summary the
//     agent sees is the section that matched;
//   - cleaned the way Postgres search is (corpus_searchable): the i18n switcher markup and pane
//     markers are scaffolding, not content.

package usecase

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
)

// The Go twin of the SQL corpus_searchable(body) (schema.sql): drop every line carrying a
// <label>/<input> tag (the i18n switcher), and every bare `[!i18n]` / `[!lang] xx` marker line.
// TestSearchableMatchesSQL holds the two to the same output.
var (
	switcherLineRe = regexp.MustCompile(`(?im)^.*</?(label|input)[ />].*$`)
	paneMarkerRe   = regexp.MustCompile(`(?im)^[ \t>]*\[!(i18n|lang)\][+-]?[ \t]*[a-z-]*[ \t]*$`)
)

// Searchable —— the body as search sees it (see corpus_searchable).
func Searchable(body string) string {
	return paneMarkerRe.ReplaceAllString(switcherLineRe.ReplaceAllString(body, ""), "")
}

// face —— one language's text of a note.
type face struct {
	lang string
	text string
}

// faces —— a multilingual note's faces (each with the language-neutral prose), merged per index
// language; a plain note is one face in its declared language, or the language its text reads as.
func faces(body, declared string) []face {
	doc := i18n.Parse(body)
	if !doc.Multilingual() {
		return []face{plainFace(body, declared)}
	}
	order := make([]string, 0, len(doc.Langs))
	texts := make(map[string][]string, len(doc.Langs))
	for _, code := range doc.Langs {
		lang := search.NormLang(code)
		if _, seen := texts[lang]; !seen {
			order = append(order, lang)
		}
		texts[lang] = append(texts[lang], i18n.Render(&doc, code, declared))
	}
	out := make([]face, 0, len(order))
	for _, lang := range order {
		out = append(out, face{lang: lang, text: strings.Join(texts[lang], "\n\n")})
	}
	return out
}

// plainFace —— a note with no language faces: its declared language, or what its text reads as.
func plainFace(body, declared string) face {
	if declared != "" {
		return face{lang: search.NormLang(declared), text: body}
	}
	return face{lang: search.TextLang(body), text: body}
}

// section —— a run of lines under one heading ("" = before the first heading).
type section struct {
	heading string
	body    string
}

// splitter —— the state of one sections() walk.
type splitter struct {
	cur    section
	out    []section
	buf    []string
	fenced bool
}

// flush —— closes the current section; one with neither a heading nor text is dropped.
func (s *splitter) flush() {
	s.cur.body = strings.TrimSpace(strings.Join(s.buf, "\n"))
	if s.cur.heading != "" || s.cur.body != "" {
		s.out = append(s.out, s.cur)
	}
	s.buf = s.buf[:0]
}

// line —— one line: a heading outside fenced code opens a section, anything else joins it.
func (s *splitter) line(line string) {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
		s.fenced = !s.fenced
	}
	if m := headingLineRe.FindStringSubmatch(trimmed); m != nil && !s.fenced {
		s.flush()
		s.cur = section{heading: m[2]}
		return
	}
	s.buf = append(s.buf, line)
}

// sections —— splits markdown at its headings, outside fenced code.
// ponytail: an over-long section stays one chunk; split by paragraphs if one outgrows a snippet.
func sections(text string) []section {
	s := splitter{out: []section{}, buf: []string{}}
	for line := range strings.SplitSeq(text, "\n") {
		s.line(line)
	}
	s.flush()
	return s.out
}

// noteDocs —— the chunks of one note at path. A note with no text still gets one chunk, so it
// is found by its title and aliases.
func noteDocs(ownerID string, n *repo.SyncNote, path string) []search.Doc {
	uri := entity.FormatURI(entity.DocumentGenre(n.Genre), path)
	base := search.Doc{
		NoteID: n.ID, OwnerID: ownerID, Genre: n.Genre, Path: path,
		URI: uri, URIPrefixes: uriPrefixes(uri), Title: n.Title, Aliases: nonNil(n.Aliases),
		Tags: nonNil(n.Tags), ParentID: n.ParentID, Published: n.Published,
	}
	docs := []search.Doc{}
	for _, f := range faces(n.Body, n.Lang) {
		for i, s := range sections(Searchable(f.text)) {
			d := base
			d.ID = fmt.Sprintf("%s-%s-%d", n.ID, f.lang, i)
			d.Lang, d.Heading, d.Body = f.lang, s.heading, s.body
			docs = append(docs, d)
		}
	}
	if len(docs) == 0 {
		base.ID, base.Lang = n.ID+"-"+search.LangEN+"-0", search.TextLang(n.Title)
		docs = append(docs, base)
	}
	return docs
}

// uriPrefixes —— a URI and its ancestors, genre root first: wiki://a/b → wiki://, wiki://a,
// wiki://a/b. A scope filter matches a granted subtree on these.
func uriPrefixes(uri string) []string {
	k := strings.Index(uri, "://")
	if k < 0 {
		return []string{uri}
	}
	root, segs := uri[:k+3], strings.Split(uri[k+3:], "/")
	out := []string{root}
	for i := range segs {
		if segs[i] != "" {
			out = append(out, root+strings.Join(segs[:i+1], "/"))
		}
	}
	return out
}

func nonNil(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

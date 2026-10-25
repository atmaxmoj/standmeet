// deck.go —— a role's notes, indexed: what each question's context is drawn from. The context is
// the desktop app's contextFor, byte for byte: the phone screen, the role, the choice-matrix line,
// the owner's projects, then the notes that match what was just said, each marked whose it is.

package cues

import (
	"maps"
	"regexp"
	"slices"
	"strings"
)

// Note —— one corpus note in a role's scope, in the order the corpus lists it. Genre is the corpus
// genre ("wiki" / "output" / "subjectivity"; "" = wiki); the port sets it. It lets the deck give
// the owner's own résumé/CV (subjectivity) a grounding layer ahead of general notes
// (cue-resume-binding R2, cue-layered-grounding H1), which a flat BM25 search otherwise buries.
type Note struct {
	Title string
	Path  string
	Body  string
	Genre string
	Tags  []string
}

// doNotLeadTag —— the reserved salience tag (cue-gap-discipline G3). A note the owner tags with it
// is "low salience": it may enter a card only when the question names its own topic, never as a
// keyword-dragged aside on an unrelated question. Owner data; names no material in code.
const doNotLeadTag = "do-not-lead"

// leadTag —— the positive salience tag (cue-gap-discipline G3). A note the owner tags with it is
// "high salience": within its grounding layer it leads a generic match and is not dropped for
// generic material. Owner data on the note; names no material in code.
const leadTag = "lead"

// subjectivityGenre —— the genre the owner's résumé/CV lives in.
const subjectivityGenre = "subjectivity"

var (
	projectRootRE = regexp.MustCompile(`^software/project/[^/]+$`)
	dashRE        = regexp.MustCompile(`[-_]`)
	groupRE       = regexp.MustCompile(`\(([^)]*)\)`)
	plainNameRE   = regexp.MustCompile(`(?i)^[a-z0-9]+$`)
	stackRE       = func() []*regexp.Regexp {
		out := make([]*regexp.Regexp, len(stackSource))
		for i, s := range stackSource {
			out[i] = regexp.MustCompile(s.pattern)
		}
		return out
	}()
)

// Deck —— built once per role and corpus version; read by every question.
type Deck struct {
	ix           *index
	brief        string // "this interview is for …", from the role
	projects     string // the owner's project overviews, sent with every question
	vocabulary   string // the project names, for Whisper's prompt
	units        []*unit
	overview     []string
	names        []string
	projectSlugs []string // the slug of each project root, for the named-project domain gate
	count        int
}

// NewDeck —— roleBrief is "<name> — <description>" ("" without a role).
func NewDeck(notes []Note, roleBrief string) *Deck {
	d := &Deck{brief: roleBrief}
	for i := range notes {
		d.add(&notes[i])
	}
	d.projects = strings.Join(d.overview, "\n")
	d.vocabulary = strings.Join(d.names, ", ")
	d.ix = buildIndex(d.units)
	d.units, d.overview, d.names = nil, nil, nil
	return d
}

// Count —— the notes the deck holds.
func (d *Deck) Count() int { return d.count }

// Hint —— the owner's own names for Whisper's prompt, so "StandMeet" is not heard as "stand
// meet": the project names, every stack name with each plain spelling its pattern accepts
// ("bwrap", "k8s"), the companies applied to. "" for a deck with no project.
func (d *Deck) Hint(companies []string) string {
	if d.vocabulary == "" {
		return ""
	}
	return strings.Join(d.ownNames(companies), ", ")
}

// ownNames —— the owner's own names, each once: what Whisper is told to expect, and the only
// names the rewrite layer may put in place of a mis-heard word.
func (d *Deck) ownNames(companies []string) []string {
	var names []string
	if d.vocabulary != "" {
		names = strings.Split(d.vocabulary, ", ")
	}
	names = append(append(names, stackSpellings()...), companies...)
	return lastSpelling(names)
}

func (d *Deck) add(n *Note) {
	text := cleanBody(n.Body)
	if text == "" && n.Title == "" {
		return
	}
	d.count++
	if projectRootRE.MatchString(n.Path) {
		d.names = append(d.names, dashRE.ReplaceAllString(n.Title, " "))
		d.projectSlugs = append(d.projectSlugs, projectSlug(n.Path))
		if text != "" {
			line := prefix16(spacesRE.ReplaceAllString(text, " "), projectChars)
			d.overview = append(d.overview, "- "+n.Title+": "+line)
		}
	}
	d.units = append(d.units, unitsOf(n, text)...)
}

// picked —— the owner's own résumé/CV first (so background and fit answers lead from how the owner
// describes themselves, cue-resume-binding R2 / cue-layered-grounding H1), then the best matches,
// the project notes, and the sections about a named technology; each unit once. A do-not-lead unit
// is admitted only when the question names its topic (cue-gap-discipline G3).
func (d *Deck) picked(query string, r *Round, named []string) []*unit {
	allow := d.allower(query, r)
	isSubjectivity := func(u *unit) bool { return u.genre == subjectivityGenre && allow(u) }
	isSalient := func(u *unit) bool { return u.salient && allow(u) }
	isProject := func(u *unit) bool {
		return strings.HasPrefix(u.path, "software/project/") && allow(u)
	}
	// subjectivity (résumé) leads the layer order (R2); then the facts the owner marked important,
	// so a marked fact leads the general matches and dedupe keeps it ahead of a generic one (G3
	// positive salience); then the best whole-scope matches.
	out := d.ix.search(query, subjectivityK, isSubjectivity)
	out = append(out, d.ix.search(query, salientK, isSalient)...)
	out = append(out, d.ix.search(query, topK, allow)...)
	out = append(out, d.ix.search(query, projectK, isProject)...)
	if len(named) > 0 {
		out = append(out, d.ix.search(strings.Join(named, " "), stackK, allow)...)
	}
	return dedupe(out)
}

// allower —— the per-question gate on every unit: the round's note-kind rule, salience
// (cue-gap-discipline G3), and the named-project domain gate (F1/F4, G2).
func (d *Deck) allower(query string, r *Round) func(*unit) bool {
	namedSlugs := d.namedProjects(query)
	return func(u *unit) bool {
		return r.allows(u) && salienceOK(query, u) && onNamedProject(u, namedSlugs)
	}
}

// dedupe —— each unit once, in first-seen order (so the subjectivity layer keeps its lead).
func dedupe(units []*unit) []*unit {
	seen := map[*unit]bool{}
	out := units[:0]
	for _, u := range units {
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

// salienceOK —— a normal unit always passes; a do-not-lead unit passes only when the question names
// its topic (a distinctive, non-stopword word from the unit's title appears in the question).
func salienceOK(query string, u *unit) bool {
	if !u.doNotLead {
		return true
	}
	return directlyNames(query, u.title)
}

// namedProjects —— the slugs of the project roots the question names by their own name (the
// structural domain gate, cue-defect-loop F1/F4 / cue-gap-discipline G2). Keying on the SLUG, not a
// generic body word, derives the domain from structure, not the keyword density that drifts.
func (d *Deck) namedProjects(query string) map[string]bool {
	qt := map[string]bool{}
	for _, t := range wordTokens(words(query)) {
		qt[t] = true
	}
	named := map[string]bool{}
	for _, slug := range d.projectSlugs {
		for _, t := range wordTokens(words(dashRE.ReplaceAllString(slug, " "))) {
			if qt[t] {
				named[slug] = true
				break
			}
		}
	}
	return named
}

// onNamedProject —— with no project named, every unit passes. With one or more named, a project
// note passes only when it belongs to a named project; notes outside software/project/ always pass.
func onNamedProject(u *unit, named map[string]bool) bool {
	if len(named) == 0 || !strings.HasPrefix(u.path, "software/project/") {
		return true
	}
	return named[projectSlug(u.path)]
}

// projectSlug —— the <slug> in software/project/<slug>[/…].
func projectSlug(path string) string {
	rest := strings.TrimPrefix(path, "software/project/")
	slug, _, _ := strings.Cut(rest, "/")
	return slug
}

// directlyNames —— the question carries a distinctive (non-stopword) word from the title.
func directlyNames(query, title string) bool {
	want := map[string]bool{}
	for _, t := range wordTokens(words(title)) {
		want[t] = true
	}
	for _, t := range wordTokens(words(query)) {
		if want[t] {
			return true
		}
	}
	return false
}

func (d *Deck) build(query string, r *Round, screen string) built {
	named := stackIn(query)
	units := d.picked(query, r, named)
	blocks := make([]string, 0, len(units))
	sources := make([]string, 0, len(units))
	for _, u := range units {
		blocks = append(blocks, "## "+u.title+" ("+u.path+") — "+noteKind(u)+"\n"+
			prefix16(u.text, contextChars))
		sources = append(sources, u.path)
	}
	var matrixFor []string
	if r.matrix {
		matrixFor = named
	}
	ctx := screen + d.briefBlock() + matrixLine(matrixFor) + "\n\n# Your projects\n" +
		d.projects + "\n\n# Notes that match what was just said\n" + strings.Join(blocks, "\n\n")
	return built{
		context: ctx, sources: sources, named: named,
		namedProjects: slices.Sorted(maps.Keys(d.namedProjects(query))), matrix: len(matrixFor) > 0,
		hasPosting: strings.TrimSpace(screen) != "",
	}
}

func (d *Deck) briefBlock() string {
	if d.brief == "" {
		return ""
	}
	return "# This interview\n" + d.brief + "\nLead with what matters for this role.\n\n"
}

// unitsOf —— one search unit per section; a note without headings is one unit.
func unitsOf(n *Note, text string) []*unit {
	dnl := slices.Contains(n.Tags, doNotLeadTag)
	salient := slices.Contains(n.Tags, leadTag)
	secs := sections(n.Body)
	if len(secs) <= 1 {
		return []*unit{{
			title: n.Title, path: n.Path, tags: n.Tags, text: text,
			genre: n.Genre, doNotLead: dnl, salient: salient,
		}}
	}
	out := make([]*unit, 0, len(secs))
	for _, s := range secs {
		title := n.Title
		if s.heading != "" {
			title = n.Title + " › " + s.heading
		}
		out = append(out, &unit{
			title: title, path: n.Path, tags: n.Tags, text: s.text,
			genre: n.Genre, doNotLead: dnl, salient: salient,
		})
	}
	return out
}

// stackIn —— the technologies a question names, as the notes spell them.
func stackIn(query string) []string {
	var out []string
	for i, re := range stackRE {
		if re.MatchString(query) {
			out = append(out, stackSource[i].name)
		}
	}
	return out
}

// built —— one question's context and what went into it.
type built struct {
	context string
	sources []string
	named   []string // the technologies the question named (for the choice matrix)
	// namedProjects —— project slugs the question named; project notes cite only when named (G2).
	namedProjects []string
	matrix        bool
	hasPosting    bool // the packet carried posted facts (a process answer may cite the posting)
}

// matrixLine —— REQUIRED for the technologies named (the first one leads), OFF for none.
func matrixLine(named []string) string {
	if len(named) == 0 {
		return matrixOff
	}
	return matrixOnHead + strings.Join(named, ", ") + matrixOnMid + named[0] + matrixOnTail
}

func stackSpellings() []string {
	out := make([]string, 0, 2*len(stackSource))
	for _, s := range stackSource {
		out = append(out, s.name)
		out = append(out, plainAlternatives(s.pattern)...)
	}
	return out
}

// plainAlternatives —— the plain words among the first group's alternatives ("bwrap" in
// `\b(bubble ?wrap|bwrap)\b`).
func plainAlternatives(pattern string) []string {
	m := groupRE.FindStringSubmatch(strings.TrimPrefix(pattern, "(?i)"))
	out := []string{}
	if m == nil {
		return out
	}
	for w := range strings.SplitSeq(m[1], "|") {
		if plainNameRE.MatchString(w) {
			out = append(out, w)
		}
	}
	return out
}

// lastSpelling —— names keyed by their lowercase form, as a JavaScript Map: each keeps the
// first one's place and the last one's spelling.
func lastSpelling(names []string) []string {
	at := map[string]int{}
	var out []string
	for _, n := range names {
		k := strings.ToLower(n)
		if i, ok := at[k]; ok {
			out[i] = n
			continue
		}
		at[k] = len(out)
		out = append(out, n)
	}
	return out
}

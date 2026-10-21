// deck.go —— a role's notes, indexed: what each question's context is drawn from. The context is
// the desktop app's contextFor, byte for byte: the phone screen, the role, the choice-matrix line,
// the owner's projects, then the notes that match what was just said, each marked whose it is.

package cues

import (
	"regexp"
	"strings"
)

// Note —— one corpus note in a role's scope, in the order the corpus lists it.
type Note struct {
	Title string
	Path  string
	Body  string
	Tags  []string
}

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
	ix         *index
	brief      string // "this interview is for …", from the role
	projects   string // the owner's project overviews, sent with every question
	vocabulary string // the project names, for Whisper's prompt
	units      []*unit
	overview   []string
	names      []string
	count      int
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
// ("bwrap", "k8s"), the companies applied to. Without the stack names Whisper heard "bwrap" as
// "BRAP" and "Postgres" as "post grey". "" for a deck with no project.
func (d *Deck) Hint(companies []string) string {
	if d.vocabulary == "" {
		return ""
	}
	names := strings.Split(d.vocabulary, ", ")
	names = append(append(names, stackSpellings()...), companies...)
	return strings.Join(lastSpelling(names), ", ")
}

func (d *Deck) add(n *Note) {
	text := cleanBody(n.Body)
	if text == "" && n.Title == "" {
		return
	}
	d.count++
	if projectRootRE.MatchString(n.Path) {
		d.names = append(d.names, dashRE.ReplaceAllString(n.Title, " "))
		if text != "" {
			line := prefix16(spacesRE.ReplaceAllString(text, " "), projectChars)
			d.overview = append(d.overview, "- "+n.Title+": "+line)
		}
	}
	d.units = append(d.units, unitsOf(n, text)...)
}

// picked —— the best matches, then the project notes, then the sections about a named
// technology; each unit once.
func (d *Deck) picked(query string, r *Round, named []string) []*unit {
	out := d.ix.search(query, topK, r.allows)
	out = append(out, d.ix.search(query, projectK, func(u *unit) bool {
		return strings.HasPrefix(u.path, "software/project/") && r.allows(u)
	})...)
	if len(named) > 0 {
		out = append(out, d.ix.search(strings.Join(named, " "), stackK, r.allows)...)
	}
	seen := map[*unit]bool{}
	uniq := out[:0]
	for _, u := range out {
		if !seen[u] {
			seen[u] = true
			uniq = append(uniq, u)
		}
	}
	return uniq
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
	return built{context: ctx, sources: sources, named: named, matrix: len(matrixFor) > 0}
}

func (d *Deck) briefBlock() string {
	if d.brief == "" {
		return ""
	}
	return "# This interview\n" + d.brief + "\nLead with what matters for this role.\n\n"
}

// unitsOf —— one search unit per section; a note without headings is one unit.
func unitsOf(n *Note, text string) []*unit {
	secs := sections(n.Body)
	if len(secs) <= 1 {
		return []*unit{{title: n.Title, path: n.Path, tags: n.Tags, text: text}}
	}
	out := make([]*unit, 0, len(secs))
	for _, s := range secs {
		title := n.Title
		if s.heading != "" {
			title = n.Title + " › " + s.heading
		}
		out = append(out, &unit{title: title, path: n.Path, tags: n.Tags, text: s.text})
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
	named   []string
	matrix  bool
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

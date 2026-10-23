// index.go —— BM25 over the cue units, ported line for line from the desktop app's
// buildIndex/search: the same tokens, the same scores in the same summation order, the same
// stable order on ties — so the same question picks the same notes on both sides.

package cues

import (
	"cmp"
	"math"
	"regexp"
	"slices"
	"strings"
)

const (
	// topK/projectK/stackK —— the best whole-scope matches, extra slots for the owner's project
	// notes (the source of the cue's example), and extra slots for a named technology's sections.
	// subjectivityK —— leading slots for the owner's own résumé/CV, so a background or fit answer
	// draws on how the owner describes themselves first (cue-resume-binding R2).
	topK          = 6
	projectK      = 3
	stackK        = 3
	subjectivityK = 2
	// salientK —— leading slots for the facts the owner marked important (cue-gap-discipline G3,
	// positive salience): within the general layer a marked fact leads a generic one and is not
	// dropped for generic material.
	salientK = 3
	bm25K1   = 1.2
	bm25B    = 0.75
	// titleWeight —— a unit's title counts this many times.
	titleWeight = 3
)

var (
	wordRE   = regexp.MustCompile(`[a-z0-9]+`)
	cjkRE    = regexp.MustCompile(`[\x{4e00}-\x{9fff}]+`)
	ateTail  = regexp.MustCompile(`[^aeiou]ate[sd]?$`)
	ateRE    = regexp.MustCompile(`ate[sd]?$`)
	stopWord = func() map[string]bool {
		m := map[string]bool{}
		for w := range strings.SplitSeq(stopWords, " ") {
			m[w] = true
		}
		return m
	}()
)

// Word lengths a suffix strip needs first (the app's thresholds).
const (
	overAtion = 6
	overAte   = 5
	overIng   = 5
	overEd    = 4
	overS     = 3
)

// stemRules —— tried in order; the first that applies wins.
var stemRules = []struct {
	cut  func(string) (string, bool)
	over int
}{
	{func(w string) (string, bool) { return strings.CutSuffix(w, "ation") }, overAtion},
	{func(w string) (string, bool) {
		return ateRE.ReplaceAllString(w, ""), ateTail.MatchString(w)
	}, overAte},
	{func(w string) (string, bool) { return strings.CutSuffix(w, "ing") }, overIng},
	{func(w string) (string, bool) { return strings.CutSuffix(w, "ed") }, overEd},
	{func(w string) (string, bool) {
		return strings.TrimSuffix(w, "s"), strings.HasSuffix(w, "s") && !strings.HasSuffix(w, "ss")
	}, overS},
}

// stem —— a light suffix strip so "test" meets "testing" and "isolate" meets "isolation".
func stem(w string) string {
	for _, r := range stemRules {
		if len(w) <= r.over {
			continue
		}
		if s, ok := r.cut(w); ok {
			return s
		}
	}
	return w
}

// tokens —— lowercase stemmed words, plus character bigrams for CJK runs.
func tokens(text string) []string {
	return append(wordTokens(words(text)), cjkBigrams(text)...)
}

// queryTokens —— tokens, with each adjacent pair of words also glued: speech splits names
// ("stand meet") the notes spell as one word.
func queryTokens(text string) []string {
	ws := words(text)
	out := append(wordTokens(ws), gluedPairs(ws)...)
	return append(out, cjkBigrams(text)...)
}

func words(text string) []string { return wordRE.FindAllString(strings.ToLower(text), -1) }

func wordTokens(words []string) []string {
	out := make([]string, 0, len(words))
	for _, w := range words {
		if len(w) > 1 && !stopWord[w] {
			out = append(out, stem(w))
		}
	}
	return out
}

func gluedPairs(words []string) []string {
	out := make([]string, 0, len(words))
	for i := 1; i < len(words); i++ {
		out = append(out, stem(words[i-1]+words[i]))
	}
	return out
}

func cjkBigrams(text string) []string {
	var out []string
	for _, run := range cjkRE.FindAllString(text, -1) {
		rs := []rune(run)
		for i := 1; i < len(rs); i++ {
			out = append(out, string(rs[i-1:i+1]))
		}
	}
	return out
}

// unit —— one search unit: a note's section, or a note without headings. genre is the note's
// corpus genre ("" = wiki); doNotLead is set when the note carries the do-not-lead salience tag,
// salient when it carries the lead tag — the two directions of owner salience (cue-gap-discipline
// G3).
type unit struct {
	title, path, text string
	genre             string
	tags              []string
	doNotLead         bool
	salient           bool
}

type doc struct {
	unit *unit
	tf   map[string]int
	len  int
}

type index struct {
	df   map[string]int
	docs []doc
	avg  float64
}

func docOf(u *unit) doc {
	ws := make([]string, 0, len(u.text)/titleWeight)
	for range titleWeight {
		ws = append(ws, tokens(u.title)...)
	}
	ws = append(ws, tokens(u.path)...)
	ws = append(ws, tokens(u.text)...)
	tf := map[string]int{}
	for _, w := range ws {
		tf[w]++
	}
	return doc{unit: u, tf: tf, len: len(ws)}
}

func buildIndex(units []*unit) *index {
	ix := &index{df: map[string]int{}, docs: make([]doc, 0, len(units))}
	total := 0
	for _, u := range units {
		d := docOf(u)
		ix.docs = append(ix.docs, d)
		total += d.len
		for w := range d.tf {
			ix.df[w]++
		}
	}
	ix.avg = float64(total) / float64(max(1, len(ix.docs)))
	return ix
}

type hit struct {
	unit  *unit
	score float64
}

// search —— the k best units that pass where, ties in index order (a stable sort, as V8's).
func (ix *index) search(query string, k int, where func(*unit) bool) []*unit {
	terms := uniqueTerms(query)
	var hits []hit
	for i := range ix.docs {
		d := &ix.docs[i]
		if !where(d.unit) {
			continue
		}
		if s := ix.score(d, terms); s > 0 {
			hits = append(hits, hit{d.unit, s})
		}
	}
	slices.SortStableFunc(hits, func(a, b hit) int { return cmp.Compare(b.score, a.score) })
	out := make([]*unit, 0, k)
	for _, h := range hits[:min(k, len(hits))] {
		out = append(out, h.unit)
	}
	return out
}

func uniqueTerms(query string) []string {
	var terms []string
	seen := map[string]bool{}
	for _, t := range queryTokens(query) {
		if !seen[t] {
			seen[t] = true
			terms = append(terms, t)
		}
	}
	return terms
}

// score —— BM25, summed term by term in query order. The float64() conversions keep Go from
// fusing a multiply into an add (FMA), which JavaScript never does: a different last bit can
// flip a tie.
func (ix *index) score(d *doc, terms []string) float64 {
	n := float64(len(ix.docs))
	score := 0.0
	for _, t := range terms {
		f := float64(d.tf[t])
		if f == 0 {
			continue
		}
		df := float64(ix.df[t])
		idf := math.Log(1 + (n-df+0.5)/(df+0.5))
		norm := f + float64(bm25K1*(1-bm25B+float64(bm25B*float64(d.len))/ix.avg))
		score += float64(float64(idf*f)*(bm25K1+1)) / norm
	}
	return score
}

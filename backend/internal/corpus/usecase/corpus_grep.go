// corpus_grep.go — the second retrieval path: literal / regex, never-miss.
//
// Its neighbor corpus_search goes through Meili: fuzzy, prefix, fast, and answers "what notes
// are about X". There's one thing it can't do, and no amount of tuning fixes it — whatever the
// tokenizer can't cut out, it simply can't find: a mid-word substring, a symbol glued to
// punctuation, a two-character Chinese word straddling a tokenizer boundary.
//
// This path answers exactly one question: **where does this pattern appear**. It doesn't rank,
// doesn't guess intent, doesn't rewrite the query; it scans every piece of corpus the caller has
// access to and hands back the matching lines verbatim. "If it's there, it will be found" is
// arithmetic here, not a ranking heuristic — and that's exactly why it must never have a LIMIT:
// a cap would quietly turn that sentence into "usually found".
//
// Both tools sit in front of the agent, which picks by the shape of the question. So the two
// descriptions must state **different guarantees**; if they converge, the agent can only guess,
// and nobody gets to use never-miss.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// ErrGrepPattern — the pattern failed to compile. This is an owner/agent input mistake, not
// a system fault: surface it as a human-readable message, not a 500.
var ErrGrepPattern = errors.New("corpus: invalid search pattern")

// grepMaxLinesPerNote — max lines returned per note. **This is not a cap on the result set**:
// no matching note is ever dropped, only the repeated lines within a single note get trimmed.
// The total match count is still reported honestly; an agent wanting the full text goes to
// corpus_read.
const grepMaxLinesPerNote = 5

// grepLineWidth — max characters returned per line (an overlong line would blow up the result,
// and neither a human nor an agent can take in more than one sentence anyway).
const grepLineWidth = 400

// GrepRequest — the parameters for one scan.
type GrepRequest struct {
	Pattern string
	// Fixed — treat Pattern as a literal (QuoteMeta internally). Use it to search for
	// things like "C++" / "a.b".
	Fixed bool
	// CaseSensitive — case-insensitive by default (an agent usually receives words the
	// way a human said them).
	CaseSensitive bool
}

// GrepLine — one matching line: line number (1-based) + line text.
type GrepLine struct {
	Text string
	No   int
}

// GrepHit — all matches within one note. Total is the match count for this note
// (Lines may be truncated).
type GrepHit struct {
	Path  string
	Title string
	Genre string
	Lines []GrepLine
	Total int
}

// CompileGrep — pattern → RE2. When Fixed, QuoteMeta runs first, so "C++" is never
// interpreted as a regex.
func CompileGrep(req *GrepRequest) (*regexp.Regexp, error) {
	pat := req.Pattern
	if strings.TrimSpace(pat) == "" {
		return nil, fmt.Errorf("%w: the pattern is empty", ErrGrepPattern)
	}
	if req.Fixed {
		pat = regexp.QuoteMeta(pat)
	}
	if !req.CaseSensitive {
		pat = "(?i)" + pat
	}
	re, err := regexp.Compile(pat)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrGrepPattern, err.Error())
	}
	return re, nil
}

// GrepBody — matching lines within one body. A pure function: it doesn't care where the
// scan surface comes from, so once phase two swaps in an index-backed candidate set, this
// matching step needs zero changes (that's exactly what "an index may only make it faster"
// means).
func GrepBody(re *regexp.Regexp, body string) ([]GrepLine, int) {
	lines := strings.Split(body, "\n")
	hits := make([]GrepLine, 0, grepMaxLinesPerNote)
	total := 0
	for i, line := range lines {
		// Counts **occurrences**, not matching lines: two hits on one line count as two.
		// The field is called matches, so it must hold the match count — a name saying one
		// thing while the value means another is the hardest kind of bug to spot in this code.
		n := len(re.FindAllStringIndex(line, -1))
		if n == 0 {
			continue
		}
		total += n
		if len(hits) < grepMaxLinesPerNote {
			hits = append(hits, GrepLine{No: i + 1, Text: clipLine(line)})
		}
	}
	return hits, total
}

func clipLine(s string) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= grepLineWidth {
		return string(r)
	}
	return string(r[:grepLineWidth]) + "…"
}

// grepHitsHint — initial capacity for the result slice. Hits are usually single digits;
// guessing too high wastes memory, guessing too low costs one extra grow, and neither matters —
// it has no bearing on "how many can be found" (that count has no upper bound).
const grepHitsHint = 8

// Grep — scan surface + matching. The pgCorpusLister version pulls everything from the DB
// in one shot; the driver version uses its own enumeration.
func (l *pgCorpusLister) Grep(
	ctx context.Context, ownerID string, scope access.CorpusScope, req *GrepRequest,
) ([]GrepHit, error) {
	re, cerr := CompileGrep(req)
	if cerr != nil {
		return nil, cerr
	}
	notes, nerr := l.grepNotes(ctx, ownerID, scope, re)
	if nerr != nil {
		return nil, nerr
	}
	return append(notes, l.grepWritings(ctx, ownerID, scope, re)...), nil
}

// grepNotes — pulls the three vault genres (wiki / output / subjectivity) all at once,
// then matches.
func (l *pgCorpusLister) grepNotes(
	ctx context.Context, ownerID string, scope access.CorpusScope, re *regexp.Regexp,
) ([]GrepHit, error) {
	if l.queryRepo == nil {
		return []GrepHit{}, nil
	}
	rows, err := l.queryRepo.NotesWithBodies(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("grep corpus: %w", err)
	}
	out := make([]GrepHit, 0, grepHitsHint)
	for i := range rows {
		if hit, ok := grepNoteRow(&rows[i], scope, re); ok {
			out = append(out, hit)
		}
	}
	return out, nil
}

// grepNoteRow — run one note through the ACL, then match. path is built by joining the
// root→leaf title segments (consistent with the other read paths).
func grepNoteRow(
	row *repo.GrepNoteRow, scope access.CorpusScope, re *regexp.Regexp,
) (GrepHit, bool) {
	if len(row.PathTitles) == 0 {
		return GrepHit{}, false
	}
	path := strings.Join(row.PathTitles, "/")
	if !allowsCorpusEntry(scope, row.Genre, path, row.Published) {
		return GrepHit{}, false
	}
	lines, total := GrepBody(re, row.Body)
	if total == 0 {
		return GrepHit{}, false
	}
	return GrepHit{
		Path: path, Genre: row.Genre, Total: total, Lines: lines,
		Title: row.PathTitles[len(row.PathTitles)-1],
	}, true
}

// grepWritings — writings are their own genre (not in corpus_notes), so they get a
// separate scan: skip this table and "every piece of corpus the caller can see" becomes
// an empty promise.
func (l *pgCorpusLister) grepWritings(
	ctx context.Context, ownerID string, scope access.CorpusScope, re *regexp.Regexp,
) []GrepHit {
	if l.writing == nil {
		return []GrepHit{}
	}
	rows, err := l.writing.ListPublishedByOwner(ctx, ownerID)
	if err != nil {
		return []GrepHit{}
	}
	out := make([]GrepHit, 0, grepHitsHint)
	for i := range rows {
		if hit, ok := grepWritingRow(&rows[i], scope, re); ok {
			out = append(out, hit)
		}
	}
	return out
}

func grepWritingRow(
	row *entity.Writing, scope access.CorpusScope, re *regexp.Regexp,
) (GrepHit, bool) {
	p := row.Path()
	if !allowsCorpusEntry(scope, "writing", p, row.IsPublished()) {
		return GrepHit{}, false
	}
	lines, total := GrepBody(re, row.Body())
	if total == 0 {
		return GrepHit{}, false
	}
	return GrepHit{
		Path: p, Title: row.Title(), Genre: "writing", Total: total, Lines: lines,
	}, true
}

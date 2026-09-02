// corpus_grep_test.go — never-miss is a **property**, so it's tested as a property, not
// with examples.
//
// A hand-picked example ("subsystem is found") proves nothing: it only shows that one
// string was found in that one body. This generates a batch of bodies, carves an arbitrary
// fragment out of an arbitrary one of them, and asserts it's always found — covering the
// claim "whatever is present will be found" itself. Once phase two swaps in a sparse index,
// this test doesn't change a word: it's not this test's job how the candidate set is
// gathered, its job is that the matching step never misses.

package usecase

import (
	"math/rand"
	"strings"
	"testing"
)

const (
	// grepSeed — a fixed seed. Randomness is for coverage, not for varying every run; a
	// test that occasionally goes red is a test nobody trusts.
	grepSeed      = 20260806
	grepFragSeed  = 1
	generatedN    = 200
	maxLinesPer   = 6
	maxWordsPer   = 8
	minFragRunes  = 4
	maxFragRunes  = 40
	repeatedLines = 20
)

// grepWords — the vocabulary used to generate corpus bodies. Two-character Chinese words
// are deliberately included: the thing a tokenizer can't segment out is exactly this
// tool's reason to exist, and GrepBody has to work on it exactly as well as on ASCII.
//
// mean not testing that half at all
//
//nolint:gosmopolitan // the Chinese words ARE the thing under test; swapping to ASCII would
var grepWords = []string{
	"cybernetics", "ashby", "requisite", "variety", "homeostat", "feedback",
	"控制论", "反馈回路", "自组织", "SM-4471/b", "C++", "a.b.c", "naive",
}

// generatedBodies — a batch of strings that look like note bodies.
func generatedBodies(seed int64, n int) []string {
	r := rand.New(rand.NewSource(seed)) //nolint:gosec // test corpus, not cryptographic use
	out := make([]string, 0, n)
	for range n {
		out = append(out, oneBody(r))
	}
	return out
}

func oneBody(r *rand.Rand) string {
	var b strings.Builder
	for range 1 + r.Intn(maxLinesPer) {
		for range 1 + r.Intn(maxWordsPer) {
			b.WriteString(grepWords[r.Intn(len(grepWords))])
			b.WriteByte(' ')
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// TestGrepNeverMisses — for any body and any fragment picked from it, grep must find that
// fragment in that body.
func TestGrepNeverMisses(t *testing.T) {
	t.Parallel()
	bodies := generatedBodies(grepSeed, generatedN)
	r := rand.New(rand.NewSource(grepFragSeed)) //nolint:gosec // same reason as above
	for i := range bodies {
		fragment, ok := pickFragment(r, bodies[i])
		if !ok {
			continue
		}
		re, err := CompileGrep(&GrepRequest{Pattern: fragment, Fixed: true})
		if err != nil {
			t.Fatalf("compile %q: %v", fragment, err)
		}
		if _, total := GrepBody(re, bodies[i]); total == 0 {
			t.Fatalf("fragment %q is in body %d but grep missed it", fragment, i)
		}
	}
}

// pickFragment — a random single-line span from the body (a fragment spanning lines
// isn't on any one line to begin with, and matching is done line by line).
func pickFragment(r *rand.Rand, body string) (string, bool) {
	runes := []rune(body)
	if len(runes) < minFragRunes {
		return "", false
	}
	start := r.Intn(len(runes) - minFragRunes + 1)
	end := start + 1 + r.Intn(min(len(runes)-start, maxFragRunes))
	frag := string(runes[start:end])
	if strings.TrimSpace(frag) == "" || strings.Contains(frag, "\n") {
		return "", false
	}
	return frag, true
}

// TestGrepFixedQuotesMetacharacters — under fixed mode, "C++" / "a.b.c" are taken as
// literals. Without this test, those two strings would be treated as regex: "C++" would
// simply fail to compile, and "a.b.c" would match places it shouldn't.
func TestGrepFixedQuotesMetacharacters(t *testing.T) {
	t.Parallel()
	re, err := CompileGrep(&GrepRequest{Pattern: "a.b.c", Fixed: true})
	if err != nil {
		t.Fatalf("compile fixed: %v", err)
	}
	if _, total := GrepBody(re, "axbxc is not a.b.c"); total != 1 {
		t.Fatalf("fixed pattern matched the regex way (total=%d)", total)
	}
	if _, cerr := CompileGrep(&GrepRequest{Pattern: "C++", Fixed: true}); cerr != nil {
		t.Fatalf("C++ must be searchable as a literal: %v", cerr)
	}
}

// TestGrepBadPatternIsAnInputError — fails to compile → ErrGrepPattern (translated to a
// human-readable line at the face), not a panic and not "not found". Silently returning
// an empty set would be the worst outcome: the agent would read it as "not in the corpus".
func TestGrepBadPatternIsAnInputError(t *testing.T) {
	t.Parallel()
	for _, pat := range []string{"unclosed(", "[a-", "*"} {
		if _, err := CompileGrep(&GrepRequest{Pattern: pat}); err == nil {
			t.Fatalf("pattern %q compiled — a broken pattern must be reported", pat)
		}
	}
	if _, err := CompileGrep(&GrepRequest{Pattern: "   "}); err == nil {
		t.Fatal("an empty pattern must be reported, not matched against everything")
	}
}

// TestGrepCountsAndCaps — the total hit count is reported truthfully, but the number of
// lines returned per note is capped. The two must never be conflated: what gets truncated
// is **lines**, not hit notes — truncate the latter and never-miss is gone.
func TestGrepCountsAndCaps(t *testing.T) {
	t.Parallel()
	body := strings.Repeat("needle here\n", repeatedLines)
	re, err := CompileGrep(&GrepRequest{Pattern: "needle", Fixed: true})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	lines, total := GrepBody(re, body)
	if total != repeatedLines {
		t.Fatalf("total = %d, want %d (the count must not be capped)", total, repeatedLines)
	}
	if len(lines) != grepMaxLinesPerNote {
		t.Fatalf("lines = %d, want %d", len(lines), grepMaxLinesPerNote)
	}
}

// TestGrepCaseInsensitiveByDefault — case-insensitive by default (what the agent gets is
// mostly a word a human said out loud); case-sensitivity only kicks in when asked for
// explicitly.
func TestGrepCaseInsensitiveByDefault(t *testing.T) {
	t.Parallel()
	loose, err := CompileGrep(&GrepRequest{Pattern: "Ashby", Fixed: true})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if _, total := GrepBody(loose, "ashby wrote"); total != 1 {
		t.Fatal("default matching must ignore case")
	}
	strict, serr := CompileGrep(&GrepRequest{Pattern: "Ashby", Fixed: true, CaseSensitive: true})
	if serr != nil {
		t.Fatalf("compile: %v", serr)
	}
	if _, total := GrepBody(strict, "ashby wrote"); total != 0 {
		t.Fatal("case_sensitive must be honoured")
	}
}

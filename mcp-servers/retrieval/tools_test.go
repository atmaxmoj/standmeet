package main

import (
	"strings"
	"testing"
)

// TestSearchAndGrepPromiseDifferentThings —— these two descriptions ARE the
// functionality.
//
// The agent picks between them by reading these descriptions. The moment someone
// edits one to sound like the other (e.g. adding "search the corpus by keyword"
// to grep too), the agent can only pick blindly: it uses ranked retrieval when it
// needed a guarantee, the answer ends up missing something, and no test goes red
// for it — both tools still "run fine".
//
// So what's being pinned down here isn't wording, it's **the difference in
// guarantee**: one description must say ranked/tolerant, the other must say
// exhaustive/exact.
func TestSearchAndGrepPromiseDifferentThings(t *testing.T) {
	t.Parallel()
	search := strings.ToLower(searchTool().Description)
	grep := strings.ToLower(grepTool().Description)

	if search == grep {
		t.Fatal("the two descriptions are identical — the agent cannot choose")
	}
	// grep's description must state its guarantee clearly: exhaustive + exact.
	for _, want := range []string{"every place", "exhaustive", "exact"} {
		if !strings.Contains(grep, want) {
			t.Fatalf("corpus_grep's description no longer says %q — "+
				"never-miss is only reachable if the description states it", want)
		}
	}
	// And search's description must state clearly that it is keyword retrieval
	// (must not be changed to claim "exact/exhaustive").
	if !strings.Contains(search, "keyword") {
		t.Fatal("corpus_search's description no longer says it is a keyword search")
	}
	for _, forbidden := range []string{"every place", "exhaustive"} {
		if strings.Contains(search, forbidden) {
			t.Fatalf("corpus_search's description now claims %q — "+
				"it is a ranked index and cannot promise that", forbidden)
		}
	}
}

// TestGrepToolShape —— the param names line up with the fields the host side
// parses (pattern / fixed / case_sensitive). A name mismatch doesn't error, it
// just silently always falls through to the default — the kind of bug where
// fixed is passed but never takes effect.
func TestGrepToolShape(t *testing.T) {
	t.Parallel()
	schema := string(grepTool().RawInputSchema)
	for _, field := range []string{`"pattern"`, `"fixed"`, `"case_sensitive"`} {
		if !strings.Contains(schema, field) {
			t.Fatalf("corpus_grep schema is missing %s", field)
		}
	}
}

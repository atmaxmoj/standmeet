package snowflake //nolint:testpackage // white-box: needs unexported internals + Node.now

import (
	"strings"
	"testing"
)

const (
	manyIDs    = 20000
	manySlugs  = 5000
	tickReads  = 1000 // rollover clock: advance 1ms every this-many reads
	maxSlugLen = 12   // a 63-bit id base62-encodes to <= 11 chars
)

func mustNode(t *testing.T, id int64) *Node {
	t.Helper()
	n, err := New(id)
	if err != nil {
		t.Fatalf("New(%d): %v", id, err)
	}
	return n
}

// TestUniqueAndMonotonic — many ids in a row are all distinct and strictly increasing (the property
// the code slug relies on: no collision, no coordination).
func TestUniqueAndMonotonic(t *testing.T) {
	t.Parallel()
	n := mustNode(t, 1)
	seen := make(map[int64]bool, manyIDs)
	var prev int64
	for i := range manyIDs {
		id := n.Next()
		if seen[id] {
			t.Fatalf("duplicate id %d at %d", id, i)
		}
		if id <= prev {
			t.Fatalf("id not increasing: %d <= %d", id, prev)
		}
		seen[id] = true
		prev = id
	}
}

// TestSequenceRollover — >4096 ids in one ms stay unique: the sequence exhausts and the generator
// advances to the next ms. A slowly-ticking clock (1ms per 1000 reads) keeps many Next() calls in
// one ms so the rollover path runs, while still letting the spin exit.
func TestSequenceRollover(t *testing.T) {
	t.Parallel()
	var reads int64
	n := &Node{nodeID: 2, now: func() int64 { reads++; return epochMs + tickReads + reads/tickReads }}
	seen := make(map[int64]bool, maxSeq*3)
	var prev int64
	for i := range maxSeq * 3 {
		id := n.Next()
		if seen[id] {
			t.Fatalf("duplicate id within the rollover window at %d", i)
		}
		if id <= prev {
			t.Fatalf("id not increasing across rollover: %d <= %d", id, prev)
		}
		seen[id] = true
		prev = id
	}
}

// TestSlugShapeAndUnique — slugs are non-empty, short, base62, and distinct.
func TestSlugShapeAndUnique(t *testing.T) {
	t.Parallel()
	n := mustNode(t, 0)
	seen := make(map[string]bool, manySlugs)
	for range manySlugs {
		s := n.Slug()
		assertBase62Slug(t, s)
		if seen[s] {
			t.Fatalf("duplicate slug %q", s)
		}
		seen[s] = true
	}
}

func assertBase62Slug(t *testing.T, s string) {
	t.Helper()
	if s == "" || len(s) > maxSlugLen {
		t.Fatalf("slug %q has a bad length", s)
	}
	if strings.TrimLeft(s, base62Alphabet) != "" {
		t.Fatalf("slug %q has a non-base62 char", s)
	}
}

func TestNodeRange(t *testing.T) {
	t.Parallel()
	if _, err := New(-1); err == nil {
		t.Fatal("negative node id must error")
	}
	if _, err := New(maxNode + 1); err == nil {
		t.Fatal("node id above max must error")
	}
	if _, err := New(maxNode); err != nil {
		t.Fatalf("max node id must be valid: %v", err)
	}
}

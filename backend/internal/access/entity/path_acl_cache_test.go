package entity

import "testing"

// TestCompileGlobCached —— the same pattern returns the same compiled regex instance twice
// (proves the cache works and the hot path does not recompile). Behavioral correctness is
// guarded by corpus ACL's e2e / other domain tests.
func TestCompileGlobCached(t *testing.T) {
	a := compileGlob("wiki://projects/**")
	b := compileGlob("wiki://projects/**")
	if a != b {
		t.Fatal("compileGlob not cached: got two distinct instances")
	}
	// Caching does not change matching semantics.
	if !a.MatchString("wiki://projects/lucerna") {
		t.Fatal("cached glob failed to match expected uri")
	}
	if a.MatchString("wiki://personal/family") {
		t.Fatal("cached glob matched an out-of-scope uri")
	}
}

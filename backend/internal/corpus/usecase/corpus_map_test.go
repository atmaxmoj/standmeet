package usecase

import "testing"

const (
	tightBudget = 6
	wideBudget  = 40
	denseSubN   = 20
	hugeSubN    = 60
)

func mapEntries(paths ...string) []MapEntry {
	out := make([]MapEntry, len(paths))
	for i, p := range paths {
		out[i] = MapEntry{Path: p, Title: p}
	}
	return out
}

// findNode —— locate a node by path anywhere in a rendered map.
func findNode(nodes []MapNode, path string) *MapNode {
	for i := range nodes {
		if nodes[i].Path == path {
			return &nodes[i]
		}
		if n := findNode(nodes[i].Children, path); n != nil {
			return n
		}
	}
	return nil
}

// mustNode —— fetch a node or fail; keeps the assertions below flat (cyclop).
func mustNode(t *testing.T, nodes []MapNode, path string) *MapNode {
	t.Helper()
	n := findNode(nodes, path)
	if n == nil {
		t.Fatalf("node %q missing from map %+v", path, nodes)
	}
	return n
}

// TestBudgetDrivesDepth —— the dense subtree is expanded, the sparse one is collapsed with a
// count, under a tight budget. Depth is a result of density, not a fixed parameter.
func TestBudgetDrivesDepth(t *testing.T) {
	t.Parallel()
	// dense/ has 6 descendants; sparse/ has 1.
	m := BuildCorpusMap(mapEntries(
		"dense", "dense/a", "dense/b", "dense/c", "dense/a/x", "dense/a/y",
		"sparse", "sparse/only",
	), "", tightBudget)

	dense := mustNode(t, m, "dense")
	if len(dense.Children) == 0 {
		t.Fatalf("dense subtree should have been expanded (most hidden nodes): %+v", dense)
	}
	sparse := mustNode(t, m, "sparse")
	if len(sparse.Children) != 0 || !sparse.Truncated {
		t.Fatalf("sparse should stay collapsed+truncated under tight budget: %+v", sparse)
	}
}

// TestUnderScopesToSubtree —— corpus_map(under=X) returns X's children, and the same budget
// algorithm applies locally (drill = the same operator).
func TestUnderScopesToSubtree(t *testing.T) {
	t.Parallel()
	e := mapEntries("root", "root/a", "root/b", "root/a/deep", "other")
	m := BuildCorpusMap(e, "root", wideBudget)
	if findNode(m, "other") != nil {
		t.Fatalf("under=root must not include the 'other' subtree: %+v", m)
	}
	mustNode(t, m, "root/a")
	mustNode(t, m, "root/b")
}

// leafPaths —— `parent` plus n distinct leaf children under it.
func leafPaths(parent string, n int) []string {
	out := make([]string, 0, 1+n)
	out = append(out, parent)
	for i := range n {
		out = append(out, parent+"/n"+string(rune('a'+i%26))+string(rune('0'+i/26)))
	}
	return out
}

// assertCollapsed —— a node is present, carries its full count, and is left truncated.
func assertCollapsed(t *testing.T, n *MapNode, wantCount int) {
	t.Helper()
	if n.Count != wantCount || !n.Truncated || len(n.Children) != 0 {
		t.Fatalf("node must be collapsed with count %d + truncated flag: %+v", wantCount, n)
	}
}

// TestCollapsedNodeCarriesCount —— a node that loses the budget race to a denser sibling still
// tells the agent how much is hidden, so a gap reads as "drill here", never as "empty".
func TestCollapsedNodeCarriesCount(t *testing.T) {
	t.Parallel()
	paths := append(leafPaths("big", denseSubN), leafPaths("huge", hugeSubN)...)
	m := BuildCorpusMap(mapEntries(paths...), "", tightBudget)
	assertCollapsed(t, mustNode(t, m, "big"), denseSubN+1)
}

// TestFlatHoarderVaultIsHonest —— everything under one node with no substructure: the map shows
// one row with the count, which is itself the signal "no structure, use search".
func TestFlatHoarderVaultIsHonest(t *testing.T) {
	t.Parallel()
	m := BuildCorpusMap(mapEntries(leafPaths("notes", hugeSubN)...), "", wideBudget)
	if len(m) != 1 || m[0].Path != "notes" {
		t.Fatalf("flat vault should surface one honest row, got %d roots", len(m))
	}
}

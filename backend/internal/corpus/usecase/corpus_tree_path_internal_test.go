// corpus_tree_path_internal_test.go —— path assignment must be deterministic.
//
// When two siblings slug to the same segment, treePathsFor disambiguates with -2/-3. That suffix
// must depend ONLY on the node set, never on the order the rows arrived in: the sidebar tree and
// the /wiki/<path> landing fetch build the set from different queries, so if the suffix flipped
// with input order, a tree node would link to a path the fetch side resolves to the OTHER node —
// the "click one, open the other" bug (2026-10-28). The fix sorts by id before assigning.

package usecase

import (
	"reflect"
	"testing"
)

// twoSoftwareTrees —— the shape that bit us: two roots both titled "software", each with a child
// titled "project". Returned in a caller-chosen order.
func twoSoftwareTrees(order []int) []pathNode {
	all := []pathNode{
		{id: "a-root", title: "software"},
		{id: "b-root", title: "software"},
		{id: "a-proj", title: "project", parentID: "a-root", hasParent: true},
		{id: "b-proj", title: "project", parentID: "b-root", hasParent: true},
	}
	out := make([]pathNode, len(order))
	for i, idx := range order {
		out[i] = all[idx]
	}
	return out
}

func TestTreePathsDeterministicAcrossInputOrder(t *testing.T) {
	t.Parallel()
	forward := treePathsFor(twoSoftwareTrees([]int{0, 1, 2, 3}))
	reversed := treePathsFor(twoSoftwareTrees([]int{3, 2, 1, 0}))
	shuffled := treePathsFor(twoSoftwareTrees([]int{2, 0, 3, 1}))
	if !reflect.DeepEqual(forward, reversed) {
		t.Fatalf("path map changed with input order:\n forward=%v\n reversed=%v", forward, reversed)
	}
	if !reflect.DeepEqual(forward, shuffled) {
		t.Fatalf("path map changed with input order:\n forward=%v\n shuffled=%v", forward, shuffled)
	}
}

// TestTreePathsInjectiveAndStableSuffix —— every id gets a distinct path, and the -2 suffix lands
// on a fixed id (the later one by id order), not whichever row came first.
func TestTreePathsInjectiveAndStableSuffix(t *testing.T) {
	t.Parallel()
	got := treePathsFor(twoSoftwareTrees([]int{0, 1, 2, 3}))
	seen := map[string]string{}
	for id, p := range got {
		if other, dup := seen[p]; dup {
			t.Fatalf("path %q maps to two ids: %q and %q", p, other, id)
		}
		seen[p] = id
	}
	// a-root sorts before b-root, so a-root keeps "software" and b-root gets "software-2".
	if got["a-root"] != "software" || got["b-root"] != "software-2" {
		t.Fatalf("unstable suffix: a-root=%q b-root=%q (want software / software-2)",
			got["a-root"], got["b-root"])
	}
}

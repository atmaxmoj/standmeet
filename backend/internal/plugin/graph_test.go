// graph_test.go — the dependency graph exposes provides/requires and the reverse edge
// (RequiredBy) the fiber view's relied-lock needs.

package plugin_test

import (
	"slices"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/plugin"
)

func nodeByID(t *testing.T, g []plugin.GraphNode, id string) plugin.GraphNode {
	t.Helper()
	for i := range g {
		if g[i].ID == id {
			return g[i]
		}
	}
	t.Fatalf("no graph node %q", id)
	return plugin.GraphNode{}
}

func requireHas(t *testing.T, label string, xs []string, want string) {
	t.Helper()
	if !slices.Contains(xs, want) {
		t.Fatalf("%s = %v, must contain %q", label, xs, want)
	}
}

func requireEmpty(t *testing.T, label string, xs []string) {
	t.Helper()
	if xs == nil {
		t.Fatalf("%s is nil, must be empty slice", label)
	}
	if len(xs) != 0 {
		t.Fatalf("%s = %v, must be empty", label, xs)
	}
}

func TestGraph_ReverseEdgeAndShape(t *testing.T) {
	t.Parallel()
	// db provides "db"; store requires "db" and provides "store"; consumer requires "store".
	g := plugin.Graph([]plugin.Manifest{
		mani("db", "db"),
		mani("store", "store", "db"),
		mani("consumer", "", "store"),
	})
	requireHas(t, "db.RequiredBy", nodeByID(t, g, "db").RequiredBy, "store")
	store := nodeByID(t, g, "store")
	requireHas(t, "store.RequiredBy", store.RequiredBy, "consumer")
	requireHas(t, "store.Requires", store.Requires, "db")
	requireEmpty(t, "consumer.RequiredBy", nodeByID(t, g, "consumer").RequiredBy)
}

func TestGraph_NoRequiresIsEmptyNotNil(t *testing.T) {
	t.Parallel()
	n := nodeByID(t, plugin.Graph([]plugin.Manifest{mani("solo", "x")}), "solo")
	requireEmpty(t, "solo.Requires", n.Requires)
	requireEmpty(t, "solo.RequiredBy", n.RequiredBy)
}

func TestRequiredBy(t *testing.T) {
	t.Parallel()
	set := []plugin.Manifest{
		mani("provider", "seam"),
		mani("consumer", "app", "seam"),
		mani("leaf", ""),
	}
	// the provider is relied upon by the consumer, and named.
	requireHas(t, "RequiredBy(provider)", plugin.RequiredBy(set, "provider"), "consumer")
	// a leaf nothing needs, and a provider-less block, are relied upon by no one.
	requireEmpty(t, "RequiredBy(consumer)", plugin.RequiredBy(set, "consumer"))
	requireEmpty(t, "RequiredBy(leaf)", plugin.RequiredBy(set, "leaf"))
	// an id not in the set is empty, never nil.
	requireEmpty(t, "RequiredBy(absent)", plugin.RequiredBy(set, "absent"))
}

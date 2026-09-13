// cycle_test.go — the dependency graph (A requires a seam B provides → A→B) must be detected as
// cyclic when it is, and left alone when it is a DAG.

package plugin_test

import (
	"slices"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/plugin"
)

func mani(id, provides string, requires ...string) plugin.Manifest {
	return plugin.Manifest{ID: id, Provides: provides, Requires: requires}
}

func TestCycle_DAGHasNone(t *testing.T) {
	t.Parallel()
	// consumer → mid → db; a chain, no cycle.
	ms := []plugin.Manifest{
		mani("db", "db"),
		mani("mid", "mid", "db"),
		mani("consumer", "", "mid"),
	}
	if cyc := plugin.Cycle(ms); len(cyc) > 0 {
		t.Fatalf("acyclic graph reported a cycle: %v", cyc)
	}
}

func TestCycle_TwoBlockCycleDetected(t *testing.T) {
	t.Parallel()
	// A requires B's seam, B requires A's seam → a cycle with no load order.
	ms := []plugin.Manifest{
		mani("a", "seam-a", "seam-b"),
		mani("b", "seam-b", "seam-a"),
	}
	cyc := plugin.Cycle(ms)
	if len(cyc) == 0 {
		t.Fatal("A↔B dependency cycle not detected")
	}
	if !slices.Contains(cyc, "a") || !slices.Contains(cyc, "b") {
		t.Fatalf("cycle %v must name both blocks on it", cyc)
	}
}

func TestCycle_SelfCycleDetected(t *testing.T) {
	t.Parallel()
	// A requires the very seam it provides.
	ms := []plugin.Manifest{mani("loop", "s", "s")}
	if cyc := plugin.Cycle(ms); len(cyc) == 0 {
		t.Fatal("self-dependency cycle not detected")
	}
}

func TestCycle_UnprovidedRequireIsNotACycle(t *testing.T) {
	t.Parallel()
	// requires a seam nobody provides: a dangling edge, gated elsewhere, not a cycle.
	ms := []plugin.Manifest{mani("lonely", "x", "nobody-provides-this")}
	if cyc := plugin.Cycle(ms); len(cyc) > 0 {
		t.Fatalf("dangling require reported a cycle: %v", cyc)
	}
}

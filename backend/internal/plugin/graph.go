// graph.go — the block dependency graph, as data.
//
// The owner's fiber view draws the composition: which block provides what, which requires what,
// and — for the "Active toggle is locked while something relies on this" rule — what relies on
// each block (everything-is-a-block.md, the fiber view "shows what relies on them"). That reverse
// edge (`RequiredBy`) is the one the UI cannot cheaply compute from a flat list, so the host
// computes it here, from the same provides/requires manifests the cycle check reads.

package plugin

// GraphNode — one block in the dependency graph. RequiredBy is the reverse edge: the ids of blocks
// that require the seam this block provides (empty when nothing relies on it). Edges forward
// (Requires → whoever provides) are derivable by the reader from Provides across nodes.
type GraphNode struct {
	ID         string   `json:"id"`
	Provides   string   `json:"provides"`
	Requires   []string `json:"requires"`
	RequiredBy []string `json:"required_by"`
}

// Graph — the dependency graph over these manifests. Pure; the caller gathers the manifest set
// (builtins + the owner's installed) the same way the cycle check does.
func Graph(manifests []Manifest) []GraphNode {
	requirers := requirerIndex(manifests) // seam → ids that require it
	out := make([]GraphNode, 0, len(manifests))
	for i := range manifests {
		m := &manifests[i]
		out = append(out, GraphNode{
			ID:         m.ID,
			Provides:   m.Provides,
			Requires:   requiresOf(m),
			RequiredBy: reliedBy(m, requirers),
		})
	}
	return out
}

// requirerIndex — seam → the ids of blocks that require it.
func requirerIndex(manifests []Manifest) map[string][]string {
	out := map[string][]string{}
	for i := range manifests {
		for _, seam := range manifests[i].Requires {
			out[seam] = append(out[seam], manifests[i].ID)
		}
	}
	return out
}

// requiresOf — the block's required seams, never nil (no-nil-container).
func requiresOf(m *Manifest) []string {
	if m.Requires == nil {
		return []string{}
	}
	return m.Requires
}

// reliedBy — the ids that require the seam this block provides; empty when it provides nothing or
// nothing needs it.
func reliedBy(m *Manifest, requirers map[string][]string) []string {
	if m.Provides == "" {
		return []string{}
	}
	if rb := requirers[m.Provides]; rb != nil {
		return rb
	}
	return []string{}
}

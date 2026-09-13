// cycle.go — the block dependency graph must be acyclic.
//
// A block `provides` one seam and `requires` others; block A depends on block B when A requires a
// seam B provides. The composition of installed blocks is that dependency graph, and it must be a
// DAG: a cycle (A needs B, B needs A) has no load order that satisfies both, so resolution refuses
// it rather than mount a composition that can never come up (everything-is-a-block.md — "a cyclic
// composition is refused ... the composition is not mounted"). The owner declares blocks one at a
// time and install does not otherwise validate requires, so the check runs at install over the
// whole set; builtins are ours and acyclic, and refusing at each install keeps the set a DAG.

package plugin

// Cycle — a dependency cycle among these manifests, as the block ids on it (in order, the first id
// repeated implicitly), or nil when the graph is acyclic. Edge A→B: A requires a seam B provides.
func Cycle(manifests []Manifest) []string {
	provider := providerIndex(manifests)
	color := make(map[int]int, len(manifests)) // 0 white, 1 gray (on stack), 2 black (done)
	var stack []int
	for i := range manifests {
		if color[i] != 0 {
			continue
		}
		if cyc := visit(manifests, provider, i, color, &stack); len(cyc) > 0 {
			return cyc
		}
	}
	return []string{}
}

// providerIndex — seam → the manifest indices that provide it. A block with no `provides` supplies
// nothing and is only ever a consumer.
func providerIndex(manifests []Manifest) map[string][]int {
	out := map[string][]int{}
	for i := range manifests {
		if s := manifests[i].Provides; s != "" {
			out[s] = append(out[s], i)
		}
	}
	return out
}

// visit — DFS from block i, pushing it onto the gray stack; a gray successor is a back-edge, i.e. a
// cycle, returned as the ids from that successor round to i.
func visit(
	manifests []Manifest, provider map[string][]int, i int, color map[int]int, stack *[]int,
) []string {
	color[i] = 1
	*stack = append(*stack, i)
	for _, seam := range manifests[i].Requires {
		for _, j := range provider[seam] {
			if cyc := step(manifests, provider, j, color, stack); len(cyc) > 0 {
				return cyc
			}
		}
	}
	*stack = (*stack)[:len(*stack)-1]
	color[i] = 2
	return []string{}
}

// step — follow an edge into j: a gray j closes a cycle; a white j recurses.
func step(
	manifests []Manifest, provider map[string][]int, j int, color map[int]int, stack *[]int,
) []string {
	if color[j] == 1 {
		return cycleFrom(manifests, *stack, j)
	}
	if color[j] == 0 {
		return visit(manifests, provider, j, color, stack)
	}
	return []string{}
}

// cycleFrom — the block ids on the gray stack from the back-edge target to the top.
func cycleFrom(manifests []Manifest, stack []int, target int) []string {
	from := 0
	for k, idx := range stack {
		if idx == target {
			from = k
			break
		}
	}
	out := make([]string, 0, len(stack)-from)
	for _, idx := range stack[from:] {
		out = append(out, manifests[idx].ID)
	}
	return out
}

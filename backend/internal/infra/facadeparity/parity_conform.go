package facadeparity

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
)

// Violation —— a conformance breach: a facade that must expose an op but doesn't ("missing"); a
// facade exposing a declared op that belongs to the OTHER trust plane ("leak"); or a facade
// exposing an op the manifest doesn't declare at all ("orphan").
type Violation struct {
	Facade string
	OpID   string
	Kind   string
}

func (v Violation) String() string {
	return fmt.Sprintf("%s: facade %q %s op %q", v.Kind, v.Facade, v.Kind, v.OpID)
}

// Exposure —— what a facade actually exposes today: the set of op IDs it serves. Built by the
// real-facade adapters (owner-MCP tool names, admin route→op mapping, visitor tool names).
type Exposure struct {
	Exposed map[string]bool
	Facade  Facade
}

// Conform —— the one cartesian check. For every facade × every manifest op: an op that must be
// exposed but isn't → "missing"; an exposed op with no manifest entry → "orphan". Sorted; empty =
// conformant.
func Conform(manifest []Op, exposures []Exposure) []Violation {
	byID := make(map[string]Op, len(manifest))
	for i := range manifest {
		byID[manifest[i].ID] = manifest[i]
	}
	out := make([]Violation, 0, len(exposures))
	for i := range exposures {
		out = append(out, missingFor(manifest, &exposures[i])...)
		out = append(out, leaksFor(byID, &exposures[i])...)
		out = append(out, orphansFor(byID, &exposures[i])...)
	}
	sortViolations(out)
	return out
}

// leaksFor —— declared ops the facade exposes that belong to the OTHER trust plane: an owner op on
// an outward facade, or an outward op on an owner facade. The hard direction wall
// (facade-directions.md) — checked both ways; distinct from "orphan" (not-in-manifest at all).
func leaksFor(byID map[string]Op, e *Exposure) []Violation {
	out := make([]Violation, 0)
	for id := range e.Exposed {
		if op, ok := byID[id]; ok && op.Reach.plane != e.Facade.Plane {
			out = append(out, Violation{Facade: e.Facade.Name, OpID: id, Kind: "leak"})
		}
	}
	return out
}

func missingFor(manifest []Op, e *Exposure) []Violation {
	out := make([]Violation, 0)
	for i := range manifest {
		op := &manifest[i]
		if e.Facade.mustExpose(op) && !e.Exposed[op.ID] {
			out = append(out, Violation{Facade: e.Facade.Name, OpID: op.ID, Kind: "missing"})
		}
	}
	return out
}

func orphansFor(byID map[string]Op, e *Exposure) []Violation {
	out := make([]Violation, 0, len(e.Exposed))
	for id := range e.Exposed {
		if _, ok := byID[id]; !ok {
			out = append(out, Violation{Facade: e.Facade.Name, OpID: id, Kind: "orphan"})
		}
	}
	return out
}

func sortViolations(vs []Violation) {
	slices.SortFunc(vs, func(a, b Violation) int {
		if c := cmp.Compare(a.Facade, b.Facade); c != 0 {
			return c
		}
		return cmp.Compare(a.OpID, b.OpID)
	})
}

// Report —— human-readable violation list for a boot panic / test failure.
func Report(vs []Violation) string {
	lines := make([]string, 0, len(vs))
	for _, v := range vs {
		lines = append(lines, "  - "+v.String())
	}
	return strings.Join(lines, "\n")
}

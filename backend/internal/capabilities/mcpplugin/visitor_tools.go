// visitor_tools.go —— the visitor tool names a manifest declares, and the check
// that reconciles them against the truth.
//
// The check lives here (where the declaration itself lives), not on the assembly
// side: the assembly side should only get the conclusion and log a line.

package mcpplugin

// ToolDrift —— where the declaration differs from the truth. Drifted=false means
// nothing to flag — either this capability never declared at all (the default for
// third-party plugins; "unknowable before dial" is allowed), or the two sides
// agree.
type ToolDrift struct {
	// DeclaredButAbsent —— in the declaration, but the sandbox didn't offer it.
	DeclaredButAbsent []string
	// OfferedButUndeclared —— the sandbox offered it, but it's not in the
	// declaration.
	OfferedButUndeclared []string
	Drifted              bool
}

// VisitorToolDrift —— checks the declaration against the truth. Order doesn't
// matter: both sides are sets, which comes first is not part of the fact.
func VisitorToolDrift(m *Manifest, actual []string) ToolDrift {
	if len(m.VisitorTools) == 0 {
		return ToolDrift{DeclaredButAbsent: []string{}, OfferedButUndeclared: []string{}}
	}
	missing := notIn(m.VisitorTools, actual)
	extra := notIn(actual, m.VisitorTools)
	return ToolDrift{
		DeclaredButAbsent: missing, OfferedButUndeclared: extra,
		Drifted: len(missing) > 0 || len(extra) > 0,
	}
}

// notIn —— the entries of names that other doesn't have.
func notIn(names, other []string) []string {
	have := make(map[string]struct{}, len(other))
	for _, n := range other {
		have[n] = struct{}{}
	}
	out := []string{}
	for _, n := range names {
		if _, ok := have[n]; !ok {
			out = append(out, n)
		}
	}
	return out
}

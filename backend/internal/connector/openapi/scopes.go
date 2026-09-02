// scopes.go — "what permission this step needs".
//
// Kept separate from runtime.go: that file handles **how to send this request** (resolving
// operationId, assembling the URL, injecting auth, sending it out); this one only answers
// **which scopes this step requires**. The two have different readers: the former is for
// debugging why a call failed, the latter is for judging **before the call happens** whether
// this owner's authorization is sufficient (F-B-8).

package openapi

// ScopesFor — the scopes this operation declares it needs, in the spec itself.
// Undeclared → an empty slice, which the caller treats as "this step requires no extra
// permission".
//
// This is the right-hand side of the judgment "granted ⊇ required"; the left-hand side
// (what was granted) lives on the connection row.
func (r *Runtime) ScopesFor(operationID string) []string {
	return r.spec.ScopesFor(operationID)
}

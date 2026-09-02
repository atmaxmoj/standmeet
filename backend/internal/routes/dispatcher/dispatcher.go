// Package dispatcher -- the outbound convergence point: every capability this instance
// exposes gets declared here once, then dispatched out to each face.
//
// # Why this extra layer
//
// Before this layer existed: the same capability was hand-written once on admin HTTP,
// and again on owner MCP. Neither hand-written copy was a projection of the other, so
// nothing guaranteed consistency between them -- only a hand-maintained cross-reference
// table (internal/infra/paritymanifest, 123 op rows) reconciled them after the fact, and
// that table itself had to be remembered and kept up too. This bred three chronic ills:
//
//   - **It leaks.** Add a capability, admin gets it and MCP forgets it (or the reverse),
//     and no mechanism responds. The ledger can only catch it if someone remembers to add
//     a row -- and forgetting the ledger row is the same kind of forgetting as forgetting
//     the face.
//   - **It drifts.** The two faces each parse their own args, validate on their own,
//     define their own payload shape, so the same capability slowly grows two different
//     shapes on the two sides (ip_bans is a real case: admin accepts reason, MCP doesn't;
//     one delete returns {"ok":true}, the other returns {"id":...}).
//   - **Policy has no single enforcement point.** Auth/quota/audit/dangerous-action
//     confirmation must be hung on every endpoint individually; miss one and it's a hole,
//     and whether one was missed can only be counted by hand.
//
// The convergence point fixes all three at once: a capability is declared exactly once,
// and each face is only its **projection**. Parity stops being something to maintain and
// becomes a structural property; policy hangs on the convergence point, so every
// capability a face gets has already passed through the same chain.
//
// The cost is one extra adaptation layer (a domain's plain function -> Op). That
// adaptation already existed, just scattered N times across handlers -- now it collapses
// into one place, and only one.
//
// # What it is not
//
// It is **not** owner-specific (unrelated to the owner domain), and it is **not** a
// second capreg (that's the declaration registry for the capability axis, tracking "what
// can this instance's agent load"). Three kinds converge here, all protocol-agnostic:
//
//  1. Domain operations -- the **plain functions** each domain's facade exposes
//     (CreateRole(ctx,in)); a domain never knows whether it's served by MCP, HTTP, IM, or
//     SDK. Protocol vocabulary like InputSchema / Handler must never appear on a domain
//     facade.
//  2. connector capabilities -- category+verb on the connector axis.
//  3. capreg capabilities -- the ones an agent loads, the outward-facing slice of them.
//
// Every face is its **projection**:
//
//	dispatcher ──► MCP    (generated: grows out of it, no hand-written step to forget)
//	           ──► HTTP   (verified: REST shape hand-written, but reconciled against the
//	                        same declaration)
//	           ──► future IM / SDK / CLI (just add a descriptor)
//
// So parity is no longer a table someone maintains by hand -- it's a structural property:
// the two faces share one source.
//
// The convergence point itself **implements no capability**: it imports each domain's
// facade and re-exports the operations they declare, gathered together. The declaration
// (id / description / input schema / reach / implementation) belongs to the domain; the
// vocabulary lives in internal/infra/facadeparity -- a neutral package both the domain and
// the convergence point can import, so a domain can speak it without depending on routing.
package dispatcher

import (
	"slices"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// opsPerResourceHint -- preallocation estimate of ops per resource (roughly the scale of
// a list/create/update/delete set).
const opsPerResourceHint = 4

// Op / Invoke are defined in internal/infra/facadeparity (a domain must be able to declare
// what it does without importing routing). The convergence point just re-exports them --
// see vocabulary.go.

// Resource -- a group of operations by resource (roles.{list,create,update,delete}
// grouped together), matching the owner's mental model and letting a reader see at a
// glance "what can this thing be made to do".
type Resource struct {
	Name string
	Ops  []Op
}

// Decorator -- a layer wrapped around Invoke. Reserved for cross-cutting policy like
// auth/quota/audit/dangerous-action confirmation.
//
// Why it lives here: every face can only get a capability through the convergence point
// (the HTTP face still hand-writes its REST shape, but the capability behind a handler
// must be pulled from here), so policy has **a single enforcement point** -- there's no
// "this endpoint forgot to add auth".
type Decorator func(op *Op, next Invoke) Invoke

// Dispatcher -- the set of all resources + the decorator chain applied to every
// operation + the faces registered against it.
//
// It answers one question: **of everything this instance can do outward, which thing is
// which.** That answer exists exactly once per process, so three things that used to be
// maintained by hand become structural properties instead:
//
//	a capability is declared once  → the two faces can't grow into two different shapes
//	a face is its projection       → a missed face gets caught by Conform (see face.go)
//	decorators hang on it          → policy has one enforcement point; there's no
//	                                  "this endpoint forgot to add it"
//
// The composition root builds **exactly one**; each face Attaches to it. Building two
// would mean going back to two hand-written declarations, and parity would have no
// meaning again.
type Dispatcher struct {
	byID       map[string]int
	resources  []Resource
	ops        []Op
	faces      []*Face
	decorators []Decorator
}

// New -- builds the convergence point from a set of resources. A duplicate id panics
// outright: two operations sharing a name means one of them can never be reached, and
// that can only be blown up at startup, not discovered later as a face missing a
// capability.
func New(resources ...Resource) *Dispatcher {
	ops, byID := flatten(resources)
	if len(byID) != len(ops) {
		panic("dispatcher: duplicate op id among resources")
	}
	return &Dispatcher{resources: resources, ops: ops, byID: byID}
}

// flatten -- flattens resource-grouped operations into one list + an id index (built
// once, lookups afterward are O(1)).
func flatten(resources []Resource) ([]Op, map[string]int) {
	ops := make([]Op, 0, len(resources)*opsPerResourceHint)
	byID := make(map[string]int, len(resources)*opsPerResourceHint)
	for i := range resources {
		for j := range resources[i].Ops {
			byID[resources[i].Ops[j].ID] = len(ops)
			ops = append(ops, resources[i].Ops[j])
		}
	}
	return ops, byID
}

// With -- appends decorators (wrapped outer-to-inner in the order passed). Applies to
// **all** operations: every capability a face gets has already passed through this chain;
// bypassing it means bypassing the convergence point -- and that path is blocked by a
// structural gate.
func (d *Dispatcher) With(decorators ...Decorator) *Dispatcher {
	d.decorators = append(d.decorators, decorators...)
	return d
}

// Resources -- all resources (a shallow slice meant as a read-only copy; callers must not
// mutate it). For enumeration/tooling use.
func (d *Dispatcher) Resources() []Resource {
	if d == nil {
		return []Resource{}
	}
	return d.resources
}

// Ops -- flattened into an operation list, each Invoke already wrapped with the decorator
// chain.
//
// A face **must not** call this directly: a face goes through Face (see face.go), where
// pulling a capability is the same act as registering its projection. It's exported here
// for enumeration use (structural gates, tests, and Face.Ops itself).
func (d *Dispatcher) Ops() []Op {
	if d == nil {
		return []Op{}
	}
	out := make([]Op, 0, len(d.ops))
	for i := range d.ops {
		op := d.ops[i]
		op.Invoke = d.decorate(&op)
		out = append(out, op)
	}
	return out
}

// ParityOps -- the shape handed to facadeparity for reconciliation (only id/kind/reach,
// no execution entry point).
func (d *Dispatcher) ParityOps() []fp.Op {
	ops := d.Ops()
	out := make([]fp.Op, 0, len(ops))
	for i := range ops {
		out = append(out, fp.Op{ID: ops[i].ID, Kind: ops[i].Kind, Reach: ops[i].Reach})
	}
	return out
}

// lookup -- fetches one operation by id, Invoke already wrapped with the decorator chain.
// **Unexported**: a face can only get a capability through Face.Op, so "which op did this
// face serve" is always a fact the convergence point recorded -- there's no fetch path
// that bypasses registration.
func (d *Dispatcher) lookup(id string) (Op, bool) {
	i, ok := d.byID[id]
	if !ok {
		return Op{}, false
	}
	op := d.ops[i]
	op.Invoke = d.decorate(&op)
	return op, true
}

// decorate -- wraps the decorator chain inside-out (the first one registered ends up
// outermost).
func (d *Dispatcher) decorate(op *Op) Invoke {
	wrapped := op.Invoke
	for _, dec := range slices.Backward(d.decorators) {
		wrapped = dec(op, wrapped)
	}
	return wrapped
}

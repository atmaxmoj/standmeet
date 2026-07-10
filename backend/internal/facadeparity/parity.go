// Package facadeparity —— the enforcement gate from docs/design/facade-parity.md.
//
// One manifest of owner capabilities is the single source of truth. Every outgoing facade (owner
// client MCP, admin HTTP, the visitor-agent tools, future IM/SDK) is checked against it: a
// capability a facade is SUPPOSED to serve but doesn't → a conformance violation, surfaced as a
// boot assertion + test failure. Omission stops being silent; leaving a capability off a facade
// becomes an explicit, reasoned OptOut or it doesn't ship.
//
// This file holds the facade-agnostic vocabulary: Reach (a capability's intent, declared by CLASS
// not by today's facade names), Op, and Facade (a projection with a capability profile). The
// cartesian conformance check lives in parity_conform.go; the concrete manifest + real-facade
// enumerations wire in on top, so a new facade is one descriptor, not a refactor.
package facadeparity

import "slices"

// Kind —— the semantic shape of an owner operation, which also fixes the HTTP verb a REST facade
// renders (Read→GET, Query→QUERY, Action→POST/PATCH/DELETE). See the QUERY work (RFC 10008).
type Kind int

// Op kinds: retrieve a named resource / derive a result from query terms / mutate state.
const (
	Read Kind = iota
	Query
	Action
)

// FacadeClass —— a coarse capability class a facade may or may not carry. Reach is declared against
// these, never against concrete facade names, so a facade added later is bound automatically.
type FacadeClass int

// Facade classes a Reach can except: browser-flow (OAuth), raw-secret-bearing, multipart upload.
const (
	Browser FacadeClass = iota
	SecretBearing
	Multipart
)

type reachBase int

const (
	reachOwnerAction reachBase = iota
	reachOwnerRead
	reachOnly
)

// Reach —— a capability op's exposure INTENT, by class. base is the default target set; except
// narrows it; only pins it to named facades (with a mandatory reason).
type Reach struct {
	reason string
	except []FacadeClass
	only   []string
	base   reachBase
}

// OwnerAction —— every owner-action facade must expose this op.
func OwnerAction() Reach { return Reach{base: reachOwnerAction} }

// OwnerRead —— every owner-read facade must expose this op.
func OwnerRead() Reach { return Reach{base: reachOwnerRead} }

// Only —— genuinely single-/few-surface: pin to named facades. Reason is mandatory (an explicit,
// reviewed decision, not a silent gap).
func Only(reason string, facades ...string) Reach {
	return Reach{base: reachOnly, only: facades, reason: reason}
}

// Except —— narrow a base reach by capability class, e.g. OwnerAction().Except(Browser).
func (r Reach) Except(classes ...FacadeClass) Reach {
	r.except = append(append([]FacadeClass{}, r.except...), classes...)
	return r
}

// Reason —— the OptOut justification for an Only reach (empty otherwise). Surfaced in audits.
func (r Reach) Reason() string { return r.reason }

// Op —— one owner operation: a stable ID, its semantic Kind, and its Reach.
type Op struct {
	ID    string
	Reach Reach
	Kind  Kind
}

// Facade —— an outgoing surface: a name, the capability classes it CAN carry (its profile), and
// whether it serves owner-actions and/or owner-reads.
type Facade struct {
	Name       string
	CanCarry   []FacadeClass
	ServesRead bool
	ServesActn bool
}

func (f Facade) carries(c FacadeClass) bool { return slices.Contains(f.CanCarry, c) }

// mustExpose —— does op belong on this facade, per the op's Reach and the facade's profile? A base
// reach hits this facade only if the facade serves that side (read/action) AND can carry every
// excepted class the op needs.
func (f Facade) mustExpose(op *Op) bool {
	if op.Reach.base == reachOnly {
		return slices.Contains(op.Reach.only, f.Name)
	}
	return f.servesSide(op.Reach.base) && f.carriesAll(op.Reach.except)
}

// servesSide —— does the facade serve the op's side? (reachOnly never reaches here — mustExpose
// handles it — so it falls through to false.)
func (f Facade) servesSide(base reachBase) bool {
	if base == reachOwnerRead {
		return f.ServesRead
	}
	return base == reachOwnerAction && f.ServesActn
}

func (f Facade) carriesAll(classes []FacadeClass) bool {
	for _, c := range classes {
		if !f.carries(c) {
			return false
		}
	}
	return true
}

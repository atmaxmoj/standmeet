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

// Facade classes a Reach can except: browser-flow (OAuth), raw-secret-bearing, multipart upload,
// Agentic (only meaningful with an LLM in the loop — ask/summarize; the api facade can't carry it).
const (
	Browser FacadeClass = iota
	SecretBearing
	Multipart
	Agentic
)

// reachSide —— which side of a facade an op needs (read vs action), or Only-pinned. Plane is a
// separate field on Reach so owner/outward reaches share the side logic. (Plane lives in plane.go.)
type reachSide int8

const (
	reachRead reachSide = iota
	reachAction
	reachOnly
)

// Reach —— a capability op's exposure INTENT: its plane, its side (read/action) or an Only pin, and
// the capability classes it needs (except narrows away facades that can't carry them).
type Reach struct {
	reason string
	except []FacadeClass
	only   []string
	side   reachSide
	plane  Plane
}

// OwnerAction —— every owner-action facade must expose this op.
func OwnerAction() Reach { return Reach{side: reachAction, plane: PlaneOwner} }

// OwnerRead —— every owner-read facade must expose this op.
func OwnerRead() Reach { return Reach{side: reachRead, plane: PlaneOwner} }

// OutwardAction —— every outward-action facade must expose this op (subject to Except, e.g. an
// Agentic op skips the api facade).
func OutwardAction() Reach { return Reach{side: reachAction, plane: PlaneOutward} }

// OutwardRead —— every outward-read facade must expose this op (subject to Except).
func OutwardRead() Reach { return Reach{side: reachRead, plane: PlaneOutward} }

// Only —— genuinely single-/few-surface: pin to named facades (owner plane). Reason is mandatory —
// an explicit, reviewed decision, not a silent gap.
func Only(reason string, facades ...string) Reach {
	return Reach{side: reachOnly, only: facades, reason: reason, plane: PlaneOwner}
}

// Plane —— the op's trust plane, consulted by the leak check in Conform.
func (r Reach) Plane() Plane { return r.plane }

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

// Facade —— an outgoing surface: a name, the trust plane it faces, the capability classes it CAN
// carry (its profile), and whether it serves reads and/or actions.
type Facade struct {
	Name       string
	CanCarry   []FacadeClass
	Plane      Plane
	ServesRead bool
	ServesActn bool
}

// Owes —— 这个面欠不欠这个 op?**生成型的面必须用它来筛**,否则"生成"就变成了"全都露出去":
// 一个写明 Only(reason, "admin") 的 op 会照样出现在 MCP 上,Reach 沦为注释。
// Conform 里的 missing/leak 两个方向问的是同一件事,所以同一份判断在这儿导出一次。
func (f Facade) Owes(op *Op) bool { return f.mustExpose(op) }

func (f Facade) carries(c FacadeClass) bool { return slices.Contains(f.CanCarry, c) }

// mustExpose —— does op belong on this facade, per the op's Reach and the facade's profile? First
// the planes must match (a cross-plane op never belongs here — see the leak check for exposing one
// anyway); then a base reach hits this facade only if the facade serves that side (read/action) AND
// can carry every excepted class the op needs.
func (f Facade) mustExpose(op *Op) bool {
	if f.Plane != op.Reach.plane {
		return false
	}
	if op.Reach.side == reachOnly {
		return slices.Contains(op.Reach.only, f.Name)
	}
	return f.servesSide(op.Reach.side) && f.carriesAll(op.Reach.except)
}

// servesSide —— does the facade serve the op's side? (reachOnly never reaches here — mustExpose
// handles it — so it falls through to false.)
func (f Facade) servesSide(side reachSide) bool {
	if side == reachRead {
		return f.ServesRead
	}
	return side == reachAction && f.ServesActn
}

func (f Facade) carriesAll(classes []FacadeClass) bool {
	for _, c := range classes {
		if !f.carries(c) {
			return false
		}
	}
	return true
}

// face.go -- faces and structural parity.
//
// Parity used to be a hand-written cross-reference table: one row per op, saying "what
// it should be called on MCP, which route it should be on admin", checked at startup
// against the real tool names and real routes. That table's only reason to exist was that
// **the two faces were each hand-written**, neither a projection of the other, so
// reconciliation could only happen by hand after the fact.
//
// Once the convergence point exists, no file should have to answer this anymore. Here's
// how:
//
//   - a face registers itself against the convergence point (Attach) and gets back a
//     Face;
//   - **the act of pulling a capability is itself the act of registering its
//     projection** -- serving an op is only possible by getting its Invoke through Face,
//     and getting it is recorded at the same moment. There's no gap where you pull it and
//     forget to register it;
//   - a generated face (MCP) goes through Face.Ops(), pulling everything at once ->
//     its completeness is constructed, not maintained; a verified face (admin HTTP)
//     hand-writes its REST shape as usual, pulling capabilities one by one via
//     Face.Op(id) -> pulling it is registering it;
//   - at startup, Conform(): each op's Reach declares which faces owe it; that's compared
//     against what was actually registered. Missing even one goes red.
//
// So parity is a structural property, not a maintained consistency. It holds for a new
// face too: the moment it Attaches, every op it owes is immediately listed -- nobody has
// to remember to update anything.

package dispatcher

import (
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// Face -- an outward-facing face's handle on the convergence-point side. profile declares
// whether this face serves reads/actions and what categories it can carry (browser flow /
// plaintext secrets / multipart); Reach uses that to decide whether this face owes a given
// op.
type Face struct {
	d       *Dispatcher
	served  map[string]bool
	profile fp.Facade
}

// Attach -- registers a face against the convergence point. Registering the same name
// twice returns the same Face (its projection record accumulates), so it's fine for a
// face's routes to be wired across several files.
func (d *Dispatcher) Attach(profile fp.Facade) *Face {
	for _, f := range d.faces {
		if f.profile.Name == profile.Name {
			return f
		}
	}
	f := &Face{d: d, profile: profile, served: map[string]bool{}}
	d.faces = append(d.faces, f)
	return f
}

// Ops -- what a generated face uses: pulls **the operations this face is supposed to
// serve** all at once, and registers them as projected. The MCP face goes this route, so
// "added an op and forgot to register it on MCP" is structurally impossible.
//
// Note it's "supposed to serve", not "all of them": the filter is Reach + this face's
// profile. Without that filter, an op explicitly marked Only(reason, "admin") would grow
// onto MCP anyway -- Reach would be a mere comment, and "generated" would degrade into
// "whatever the convergence point holds gets exposed", exactly the most dangerous default.
func (f *Face) Ops() []Op {
	all := f.d.Ops()
	out := make([]Op, 0, len(all))
	for i := range all {
		if !f.profile.Owes(&fp.Op{ID: all[i].ID, Kind: all[i].Kind, Reach: all[i].Reach}) {
			continue // face doesn't owe it -- e.g. an admin-only op must not grow onto MCP
		}
		f.served[all[i].ID] = true
		out = append(out, all[i])
	}
	return out
}

// Op -- what a verified face uses: fetch one operation by id (Invoke already wrapped with
// the decorator chain), and fetching it registers it as projected. The admin HTTP face
// uses this when wiring a route -- route shape, status codes, and arg binding are still
// hand-written as usual, but **the capability can only be pulled from here**, so "which op
// did this route serve" is a fact the convergence point knows, not a claim in a comment.
func (f *Face) Op(id string) (Op, bool) {
	op, ok := f.d.lookup(id)
	if ok {
		f.served[id] = true
	}
	return op, ok
}

// OpFiles -- fetches an operation and declares that this face will supply it
// **accompanying bytes** (multipart and the like).
//
// The only difference from Op is one guard: this face's profile must actually be able to
// carry fp.Multipart. It blocks "the MCP face also tries to hand over bytes" -- that path
// has no file picker, an owner hands over a URL there; only a handful of faces can carry
// bytes, so let the profile decide that, rather than making every handler remember it.
//
// What you get back is still the same Op, the same decorator chain: the bytes travel via
// ctx (see fp.WithFiles), not a second execution entry point. Opening a second entry point
// would mean auth/quota/audit would have to remember to wrap that one too.
func (f *Face) OpFiles(id string) (Op, bool) {
	if !f.profile.Carries(fp.Multipart) {
		return Op{}, false
	}
	return f.Op(id)
}

// MustOpFiles -- the asserting version of OpFiles, for assembly-time use. A face that
// can't carry bytes means blowing up at startup, not silently returning a 404 at runtime.
func (f *Face) MustOpFiles(id string) Op {
	op, ok := f.OpFiles(id)
	if !ok {
		panic("dispatcher: face " + f.profile.Name + " cannot carry files for op " + id)
	}
	return op
}

// MustOp -- the asserting version of Op, for assembly-time use: a misspelled id means
// blowing up at startup, not silently missing a route.
func (f *Face) MustOp(id string) Op {
	op, ok := f.Op(id)
	if !ok {
		panic("dispatcher: face " + f.profile.Name + " wants unknown op " + id)
	}
	return op
}

// Conform -- reconciles every registered face against what its Reach obligates it to
// serve. Empty = consistent.
//
// All three violation kinds come from facadeparity: missing (this face owes this op but
// never projected it), orphan (projected something the convergence point doesn't
// recognize), leak (an outward op shows up on an owner face, or vice versa).
func (d *Dispatcher) Conform() []fp.Violation {
	exposures := make([]fp.Exposure, 0, len(d.faces))
	for _, f := range d.faces {
		exposures = append(exposures, fp.Exposure{Facade: f.profile, Exposed: f.served})
	}
	return fp.Conform(d.ParityOps(), exposures)
}

// ConformReport -- a human-readable violation report (empty string = consistent). For the
// composition root to print/panic on at startup.
func (d *Dispatcher) ConformReport() string {
	vs := d.Conform()
	if len(vs) == 0 {
		return ""
	}
	return fp.Report(vs)
}

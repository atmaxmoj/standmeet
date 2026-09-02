// depresolver.go — the host's registry of named-dependency providers (connector rework).
//
// Design (docs/design/connector-deps-tests.md): a plugin manifest declares `Requires:[...]`,
// naming in-app dependencies ("calendar" / "smtp" …), each backed by a connector. The host
// registers providers into this table; `enabledCaps` resolves each cap's Requires: any one
// not-connected excludes that cap from enabledCaps (one global choke point, D-2) — hidden from
// every session alike. Credentials never enter this layer: a provider only answers "connected
// or not" (Connected) and hands back a "call handle" (never a token).

package capreg

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

// RequiresDeps — optional interface: a capability declares which named in-app dependencies it
// needs (connector names, e.g. "calendar" / "smtp"). enabledCaps gates on this: any one
// not-connected excludes the cap (global choke point, D-2). pluginCapability pulls it from
// manifest.Requires; a cap not implementing this is never connector-gated.
type RequiresDeps interface {
	Requires() []string
}

// ProvidesVisitorTools — optional interface: which tool **names** this capability provides on
// the visitor side (declared, not learned by dialing). Anywhere that must answer "who owns this
// tool" before assembly relies on it — e.g. a skill declares `allowed-tools: [calendar_book]`,
// and the product must answer "that needs the calendar connector" (F-F-4). Pairs with
// RequiresDeps: one says "which tools I provide", the other "which connectors I need" — only
// together do you get "which connector does this tool need". A capability not implementing
// this interface (third-party plugins by default) is **unknown** here, not "needs nothing" —
// keep the two facts separate.
type ProvidesVisitorTools interface {
	VisitorToolNames() []string
}

// DepsForTools — behind these tool names, which named dependencies (connector names) are
// needed, altogether. Pure in-memory, touches neither network nor DB.
//
// Only counts capabilities that **have declared their own tool names**; a miss only means this
// table doesn't recognize that tool — not that the tool needs no connector.
func (r *Registry) DepsForTools(tools []string) []string {
	want := make(map[string]struct{}, len(tools))
	for _, t := range tools {
		want[t] = struct{}{}
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, c := range r.List() {
		out = appendDepsIfProvides(out, seen, c, want)
	}
	return out
}

// appendDepsIfProvides — c provides any tool in want → merge its Requires into out (deduped).
func appendDepsIfProvides(
	out []string, seen map[string]struct{}, c Capability, want map[string]struct{},
) []string {
	return appendNewDeps(out, seen, depsOfProvider(c, want))
}

// depsOfProvider — c's own tools include one in want → its needed connectors; else empty.
func depsOfProvider(c Capability, want map[string]struct{}) []string {
	pv, isProvider := c.(ProvidesVisitorTools)
	rd, hasReqs := c.(RequiresDeps)
	if !isProvider || !hasReqs || !providesAny(pv.VisitorToolNames(), want) {
		return []string{}
	}
	return rd.Requires()
}

func appendNewDeps(out []string, seen map[string]struct{}, more []string) []string {
	for _, dep := range more {
		if _, dup := seen[dep]; dup {
			continue
		}
		seen[dep] = struct{}{}
		out = append(out, dep)
	}
	return out
}

func providesAny(names []string, want map[string]struct{}) bool {
	for _, n := range names {
		if _, hit := want[n]; hit {
			return true
		}
	}
	return false
}

// depsConnected — whether all of this cap's Requires dependencies are connected (half of the
// gate). Rules: no declared Requires / no depReg installed / no owner context → true (not
// gated); any one not-connected → false (hidden); AllConnected error (E1: DB read error, etc.)
// → treated as not-connected, hidden + logged (fail-closed: uncertain connected state never
// exposes a tool that can call out externally).
func (r *Registry) depsConnected(ctx context.Context, c Capability, in *AssembleInput) bool {
	rd, ok := c.(RequiresDeps)
	if !ok || len(rd.Requires()) == 0 {
		return true
	}
	return r.requiredDepsConnected(ctx, c, in, rd.Requires())
}

// requiredDepsConnected — resolves this set of names: no depReg / no owner context → true (not
// gated); AllConnected errors (E1) → false + log (fail-closed); else follows the resolved result.
func (r *Registry) requiredDepsConnected(
	ctx context.Context, c Capability, in *AssembleInput, names []string,
) bool {
	r.mu.RLock()
	dr := r.depReg
	r.mu.RUnlock()
	if dr == nil || in == nil || in.OwnerID == "" {
		return true
	}
	connected, err := dr.AllConnected(ctx, in.OwnerID, names)
	if err != nil {
		slog.Default().Warn("dep resolve failed, hiding capability",
			"capability", c.ID(), "requires", names, "err", err)
		return false
	}
	return connected
}

// DepProvider — a named in-app dependency ("calendar"/"smtp"), backed by a connector holding
// credentials. The host uses it to resolve a plugin's manifest Requires.
type DepProvider interface {
	// Name — the dependency name, matches the string in manifest Requires.
	Name() string
	// Connected — whether this owner has a "usable" connection (authorized + verified). The
	// gate's connected half looks only at this; not-connected → the depending cap is hidden.
	// Error = resolution failed (E1: treated as not-connected + logged).
	Connected(ctx context.Context, ownerID string) (bool, error)
}

// RequiresPerTool lives in pertool.go — action-level declaration and filtering stay together.

// OpProvider — beyond "connected or not", also answers **"can this owner actually perform this
// one action"**. Why a second question (F-B-8 ⭐⭐): `Connected` says "we have a usable
// connection" — not the same as "this connection can do what you're asking". An owner granting
// only `calendar.readonly` still has a fine connection, reads work, writes always 403 — yet the
// product would still show "book a meeting" and promise "try again later", a promise that
// never comes true.
//
// A capability names **which specific action** it needs via `Requires:
// ["calendar:events.insert"]`; no colon behaves as before. The kernel doesn't know about any
// concrete category or scope — only that some dependencies answer action-level questions;
// computing the answer is the connector axis's business.
type OpProvider interface {
	DepProvider
	// CanPerform — can this owner's current authorization actually perform op (shaped like a
	// spec's operationId).
	CanPerform(ctx context.Context, ownerID, op string) (bool, error)
}

// splitDep — `"calendar:events.insert"` → ("calendar","events.insert"); no colon → (name, "").
func splitDep(name string) (string, string) { //nolint:revive // dep + op, order is in the doc comment
	dep, op, _ := strings.Cut(name, ":")
	return dep, op
}

// NamedProvider — wraps a (name, Connected closure) pair as a DepProvider. The composition
// root uses it to register a connector proxy's Connected method (calendar / smtp) as a named
// dependency, without the connector package importing capreg back. Credentials never pass
// through this — the closure only answers "connected or not".
func NamedProvider(
	name string, connected func(ctx context.Context, ownerID string) (bool, error),
) DepProvider {
	return funcProvider{name: name, connected: connected}
}

type funcProvider struct {
	connected func(context.Context, string) (bool, error)
	name      string
}

func (p funcProvider) Name() string { return p.name }
func (p funcProvider) Connected(ctx context.Context, ownerID string) (bool, error) {
	return p.connected(ctx, ownerID)
}

// NamedOpProvider — same as NamedProvider, plus a "can it perform this action" closure. The
// composition root wires in the answer the connector axis already computed; the kernel still
// knows nothing about categories or scopes.
func NamedOpProvider(
	name string,
	connected func(ctx context.Context, ownerID string) (bool, error),
	canPerform func(ctx context.Context, ownerID, op string) (bool, error),
) DepProvider {
	return funcOpProvider{
		inner:      funcProvider{name: name, connected: connected},
		canPerform: canPerform,
	}
}

// Composition instead of embedding: an embedded field would need to sort before plain fields,
// but fieldalignment forbids that ordering too — the two lint gates conflict here. An explicit
// one-line forward beats another exemption just for field order.
type funcOpProvider struct {
	canPerform func(context.Context, string, string) (bool, error)
	inner      funcProvider
}

func (p funcOpProvider) Name() string { return p.inner.Name() }

func (p funcOpProvider) Connected(ctx context.Context, ownerID string) (bool, error) {
	return p.inner.Connected(ctx, ownerID)
}

func (p funcOpProvider) CanPerform(ctx context.Context, ownerID, op string) (bool, error) {
	return p.canPerform(ctx, ownerID, op)
}

// DepRegistry — the named-dependency provider registry the host holds. enabledCaps queries it
// to gate; at boot, Unknown validates that all manifest Requires names are known (fail-fast).
type DepRegistry struct {
	providers map[string]DepProvider
}

// NewDepRegistry — an empty registry.
func NewDepRegistry() *DepRegistry {
	return &DepRegistry{providers: map[string]DepProvider{}}
}

// Register — registers a named provider. Duplicate name panics (failing at boot beats
// colliding at runtime).
func (r *DepRegistry) Register(p DepProvider) {
	name := p.Name()
	if _, dup := r.providers[name]; dup {
		panic("capreg: duplicate dep provider " + name)
	}
	r.providers[name] = p
}

// Lookup — fetch a provider by name; unregistered → (nil, false).
func (r *DepRegistry) Lookup(name string) (DepProvider, bool) {
	p, ok := r.providers[name]
	return p, ok
}

// Unknown — returns all "unregistered" names among names (boot validation: non-empty = reject
// registering the plugin that declared it).
func (r *DepRegistry) Unknown(names []string) []string {
	var out []string
	for _, n := range names {
		dep, op := splitDep(n)
		p, ok := r.providers[dep]
		if !ok {
			out = append(out, n)
			continue
		}
		// An action was named but this provider can't answer action-level questions — also
		// "not recognized". Caught at boot: at runtime this would show as a capability
		// silently vanishing, indistinguishable from "owner isn't connected" when debugging.
		if _, isOp := p.(OpProvider); op != "" && !isOp {
			out = append(out, n)
		}
	}
	return out
}

// AllConnected — returns true only if **all** dependencies in names are connected (AND
// semantics). Provider not registered → false (defensive). Connected returning an error →
// (false, err) (E1: caller treats it as not-connected, hides it, + logs). Empty names →
// (true, nil) (a cap with no dependencies isn't gated).
func (r *DepRegistry) AllConnected(
	ctx context.Context, ownerID string, names []string,
) (bool, error) {
	for _, n := range names {
		// Same check as lacks — a separate copy would let "a dependency naming an action"
		// drift to work in only one of the two gates (one yes/no, the other names).
		missing, err := r.lacks(ctx, ownerID, n)
		if err != nil {
			return false, err
		}
		if missing {
			return false, nil
		}
	}
	return true, nil
}

// Unconnected — the ones among names that this owner has **not yet connected**. The other
// answer to the same question AllConnected answers: that one only needs a yes/no (usable or
// not), this one needs **names** (the owner needs to know which to go connect) — the "needs X
// connector" line on a marketplace card wants the latter.
//
// An unregistered name counts as "missing": this instance can't supply that dependency at all,
// same as not-connected from the owner's point of view.
func (r *DepRegistry) Unconnected(
	ctx context.Context, ownerID string, names []string,
) ([]string, error) {
	out := []string{}
	for _, n := range names {
		missing, err := r.lacks(ctx, ownerID, n)
		if err != nil {
			return nil, err
		}
		if missing {
			out = append(out, n)
		}
	}
	return out, nil
}

// lacks — whether this owner is missing this one dependency. When the name carries an action
// (`calendar:events.insert`), the question is **can it actually perform that action**, not
// "connected or not" — the latter would tell a read-only connection "yes, you're connected"
// and then every write 403s (F-B-8).
func (r *DepRegistry) lacks(ctx context.Context, ownerID, name string) (bool, error) {
	dep, op := splitDep(name)
	p, ok := r.providers[dep]
	if !ok {
		return true, nil
	}
	if op != "" {
		return lacksOp(ctx, ownerID, p, dep, op)
	}
	connected, err := p.Connected(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("dep %q connected check: %w", dep, err)
	}
	return !connected, nil
}

// lacksOp — the action-level question. When the provider can't answer it (doesn't implement
// OpProvider), it **counts as missing**: the manifest named an action this dependency can't
// answer "can it be done" for, so the capability shouldn't be exposed at all. Unknown() already
// catches this combination at boot; reaching here at runtime means the composition root forgot
// to wire the closure.
func lacksOp(
	ctx context.Context, ownerID string, p DepProvider, dep, op string,
) (bool, error) {
	opp, ok := p.(OpProvider)
	if !ok {
		return true, nil
	}
	can, err := opp.CanPerform(ctx, ownerID, op)
	if err != nil {
		return false, fmt.Errorf("dep %q can-perform %q: %w", dep, op, err)
	}
	return !can, nil
}

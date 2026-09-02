// depresolver_test.go — connector rework unit tests for the dep provider registry. Covers
// connector-deps-tests.md §1: dep-registry, requires-boot-reject, enabledcaps-multi-dep (AND),
// connected-errors (E1).

package capreg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/stretchr/testify/require"
)

const calendarDep = "calendar"

func okConnected(context.Context, string) (bool, error) { return true, nil }

// requires-boot-reject — a manifest declares a dep core can't provide (Requires includes
// "weather"); boot validation flags it and rejects (fail-fast): run the real, parsed
// manifest.Requires through DepRegistry.Unknown — non-empty → reject + log this plugin.
func TestRequiresBootReject_UnknownDepFlagged(t *testing.T) {
	t.Parallel()
	depReg := capreg.NewDepRegistry()
	depReg.Register(capreg.NamedProvider(calendarDep, okConnected))
	depReg.Register(capreg.NamedProvider("smtp", okConnected))

	cfg := []byte(`{"plugins":[
	  {"id":"booking","version":"1","shape":"visitor_only",
	   "transport":{"kind":"stdio","command":"booking-plugin"},
	   "requires":["calendar","weather"]}
	]}`)
	res, err := mcpplugin.ParseConfig(cfg)
	require.NoError(t, err)
	require.Len(t, res.Manifests, 1)

	require.Equal(t, []string{"weather"},
		depReg.Unknown(res.Manifests[0].Requires),
		"boot validation surfaces the dep core can't provide -> plugin rejected")

	// All deps known -> Unknown empty -> accepted.
	ok := []byte(`{"plugins":[
	  {"id":"booking","version":"1","shape":"visitor_only",
	   "transport":{"kind":"stdio","command":"booking-plugin"},
	   "requires":["calendar","smtp"]}
	]}`)
	res2, err := mcpplugin.ParseConfig(ok)
	require.NoError(t, err)
	require.Empty(t, depReg.Unknown(res2.Manifests[0].Requires), "all deps known -> accepted")
}

// fakeProvider — a named provider for tests, with controllable connected state/error.
type fakeProvider struct {
	err       error
	name      string
	connected bool
}

func (p fakeProvider) Name() string { return p.name }
func (p fakeProvider) Connected(context.Context, string) (bool, error) {
	return p.connected, p.err
}

// NamedProvider — wraps a (name, Connected closure) pair as a DepProvider, passing name +
// ownerID through. The composition root uses it to register a connector proxy's Connected
// method as a named dependency.
func TestNamedProvider_Delegates(t *testing.T) {
	t.Parallel()
	var gotOwner string
	p := capreg.NamedProvider(calendarDep, func(_ context.Context, owner string) (bool, error) {
		gotOwner = owner
		return true, nil
	})
	require.Equal(t, calendarDep, p.Name())
	ok, err := p.Connected(context.Background(), "owner-9")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, "owner-9", gotOwner, "ownerID passed through to the closure")
}

// dep-registry — register → lookup hits; unknown → not found.
func TestDepRegistry_RegisterLookup(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep, connected: true})

	got, ok := r.Lookup(calendarDep)
	require.True(t, ok, "registered provider found")
	require.Equal(t, calendarDep, got.Name())

	_, ok = r.Lookup("nonexistent")
	require.False(t, ok, "unknown provider not found")
}

// dep-registry — duplicate name → panic (fails at boot).
func TestDepRegistry_DuplicatePanics(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep})
	require.PanicsWithValue(t, "capreg: duplicate dep provider calendar", func() {
		r.Register(fakeProvider{name: calendarDep})
	})
}

// requires-boot-reject (registration surface) — Unknown picks out unregistered dependency
// names (boot validation: non-empty → reject the plugin that declared it).
func TestDepRegistry_Unknown(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep})
	r.Register(fakeProvider{name: "smtp"})

	require.Empty(t, r.Unknown([]string{calendarDep, "smtp"}), "all known → empty")
	require.Empty(t, r.Unknown(nil), "no requires → empty")
	require.Equal(t, []string{"weather"}, r.Unknown([]string{calendarDep, "weather"}),
		"one unknown name surfaced")
}

// enabledcaps-multi-dep — AllConnected is AND: A connected, B not → false;
// both connected → true.
func TestDepRegistry_AllConnected_AND(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep, connected: true})
	r.Register(fakeProvider{name: "smtp", connected: false})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{calendarDep, "smtp"})
	require.NoError(t, err)
	require.False(t, ok, "A connected, B not → AND false")

	ok, err = r.AllConnected(context.Background(), "owner-1", []string{calendarDep})
	require.NoError(t, err)
	require.True(t, ok, "only the connected one → true")

	ok, err = r.AllConnected(context.Background(), "owner-1", nil)
	require.NoError(t, err)
	require.True(t, ok, "no requires → not gated (true)")
}

// enabledcaps-multi-dep — an unregistered dependency name → false (defensive,
// not treated as connected).
func TestDepRegistry_AllConnected_UnknownNameFalse(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep, connected: true})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{calendarDep, "ghost"})
	require.NoError(t, err)
	require.False(t, ok, "unknown dep name → not connected")
}

// connected-errors (E1) — provider.Connected returns an error → propagated as
// (false, err); the caller treats it as not-connected, hides it, and logs.
func TestDepRegistry_AllConnected_ProviderError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db read failed")
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep, err: sentinel})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{calendarDep})
	require.ErrorIs(t, err, sentinel, "provider error propagates")
	require.False(t, ok, "error → not connected")
}

// fakeVisitorCap — a minimal visitor-facing cap: VisitorBinding returns a real binding (not
// hidden). depCap embeds it + adds Requires (implementing RequiresDeps); noReqCap is it alone.
type fakeVisitorCap struct{ id string }

func (c fakeVisitorCap) ID() string        { return c.id }
func (fakeVisitorCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (c fakeVisitorCap) VisitorBinding(
	context.Context, *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return &capreg.Binding{State: capreg.CapabilityState{ID: c.id, Enabled: true}}, nil
}

func (fakeVisitorCap) OwnerMCPBindings() []*capreg.MCPBinding { return nil }

func (fakeVisitorCap) SystemPromptFragment(context.Context, *capreg.AssembleInput) string {
	return ""
}

func (fakeVisitorCap) SystemPromptFragmentID(context.Context, *capreg.AssembleInput) string {
	return ""
}

// depCap — declares Requires → subject to connector-gate.
type depCap struct {
	fakeVisitorCap

	requires []string
}

func (c depCap) Requires() []string { return c.requires }

// noReqCap — does not declare Requires → never connector-gated.
type noReqCap struct{ fakeVisitorCap }

func stateIDs(states []capreg.CapabilityState) []string {
	out := make([]string, 0, len(states))
	for _, s := range states {
		out = append(out, s.ID)
	}
	return out
}

// regWithCalendar — registers one cap + one calendar provider.
func regWithCalendar(c capreg.Capability, p fakeProvider) *capreg.Registry {
	reg := capreg.NewRegistry()
	reg.MustRegister(c)
	dr := capreg.NewDepRegistry()
	dr.Register(p)
	reg.SetDepRegistry(dr)
	return reg
}

func calendarBookCap() depCap {
	return depCap{
		fakeVisitorCap: fakeVisitorCap{id: "calendar.book"},
		requires:       []string{calendarDep},
	}
}

// enabledcaps-connector — `Requires:[calendar]` not connected → excluded from enabledCaps
// (VisitorStates omits it); connected → included. D-2: gating is one global choke point.
func TestEnabledCaps_ConnectorGate(t *testing.T) {
	t.Parallel()
	in := &capreg.AssembleInput{OwnerID: "o1"}

	hidden := regWithCalendar(calendarBookCap(), fakeProvider{name: calendarDep, connected: false}).
		VisitorStates(context.Background(), in)
	require.Empty(t, stateIDs(hidden), "calendar not connected -> cap hidden")

	shown := regWithCalendar(calendarBookCap(), fakeProvider{name: calendarDep, connected: true}).
		VisitorStates(context.Background(), in)
	require.Equal(t, []string{"calendar.book"}, stateIDs(shown), "calendar connected -> exposed")
}

// arbitrariness (the crux) — the gating mechanism knows nothing about specific dep names:
// swap in a brand-new, unrelated name "weather" — not-connected → hidden, connected →
// exposed, identical to calendar. Proves gating is **generic named-dependency**, not
// hardcoded to calendar/smtp — any named dependency the host supplies routes through the
// same single choke point.
func TestEnabledCaps_ArbitraryDepName_GatesIdentically(t *testing.T) {
	t.Parallel()
	const weatherDep = "weather"
	in := &capreg.AssembleInput{OwnerID: "o1"}
	weatherCap := depCap{
		fakeVisitorCap: fakeVisitorCap{id: "weather.report"},
		requires:       []string{weatherDep},
	}

	hidden := regWithCalendar(weatherCap, fakeProvider{name: weatherDep, connected: false}).
		VisitorStates(context.Background(), in)
	require.Empty(t, stateIDs(hidden), "arbitrary dep not connected -> cap hidden")

	shown := regWithCalendar(weatherCap, fakeProvider{name: weatherDep, connected: true}).
		VisitorStates(context.Background(), in)
	require.Equal(t, []string{"weather.report"}, stateIDs(shown),
		"arbitrary dep connected -> exposed (same mechanism as calendar)")
}

// errBindCap — VisitorBinding returns a controllable error, simulating an injected handle /
// injector construction failure (E3). Implements the interface directly instead of embedding
// fakeVisitorCap (avoids a fieldalignment × embeddedstructfieldcheck conflict).
type errBindCap struct {
	err error
	id  string
}

func (c errBindCap) ID() string        { return c.id }
func (errBindCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (c errBindCap) VisitorBinding(
	context.Context, *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, c.err
}

func (errBindCap) OwnerMCPBindings() []*capreg.MCPBinding { return nil }

func (errBindCap) SystemPromptFragment(context.Context, *capreg.AssembleInput) string {
	return ""
}

func (errBindCap) SystemPromptFragmentID(context.Context, *capreg.AssembleInput) string {
	return ""
}

// connector-errors (E3) — injected handle construction fails: VisitorBinding
// returns a **non-ErrHidden** error → the cap doesn't crash, it degrades to
// exposed with Enabled:false (friendly — the frontend can render a degraded
// hint); returns ErrHidden → fully hidden.
func TestVisitorState_BindBuildFailure_DegradesNotCrash(t *testing.T) {
	t.Parallel()
	in := &capreg.AssembleInput{OwnerID: "o1"}

	// A generic build failure -> stays visible but degraded (Enabled:false),
	// not dropped, no panic.
	reg := capreg.NewRegistry()
	reg.MustRegister(errBindCap{id: "flaky.cap", err: errors.New("handle build failed")})
	states := reg.VisitorStates(context.Background(), in)
	require.Len(t, states, 1, "build failure → still surfaced (degraded), not dropped")
	require.Equal(t, "flaky.cap", states[0].ID)
	require.False(t, states[0].Enabled, "build failure → Enabled:false (friendly degrade)")

	// ErrHidden -> fully hidden.
	reg2 := capreg.NewRegistry()
	reg2.MustRegister(errBindCap{id: "hidden.cap", err: capreg.ErrHidden})
	require.Empty(t, reg2.VisitorStates(context.Background(), in), "ErrHidden → fully hidden")
}

// connected-errors (E1) at the enabledCaps layer — Connected returns an
// error → hidden (fail-closed).
func TestEnabledCaps_ConnectorError_Hides(t *testing.T) {
	t.Parallel()
	in := &capreg.AssembleInput{OwnerID: "o1"}
	down := fakeProvider{name: calendarDep, err: errors.New("db down")}
	states := regWithCalendar(calendarBookCap(), down).
		VisitorStates(context.Background(), in)
	require.Empty(t, stateIDs(states), "Connected errored -> hide when uncertain")
}

// enabledcaps-global-override's "not gated" boundary —
//   - a cap that doesn't declare Requires → never connector-gated (even if the
//     provider isn't connected).
//   - no owner context (OwnerID empty) → can't resolve → not gated (present).
func TestEnabledCaps_ConnectorGate_NotGatedCases(t *testing.T) {
	t.Parallel()
	// A cap that doesn't declare Requires: stays present even if the provider
	// is down.
	always := noReqCap{fakeVisitorCap{id: "always"}}
	noReq := regWithCalendar(always, fakeProvider{name: calendarDep, connected: false}).
		VisitorStates(context.Background(), &capreg.AssembleInput{OwnerID: "o1"})
	require.Equal(t, []string{"always"}, stateIDs(noReq), "no Requires -> not connector-gated")

	// Has Requires but no owner context: can't resolve, so not gated.
	disc := fakeProvider{name: calendarDep, connected: false}
	noOwner := regWithCalendar(calendarBookCap(), disc).
		VisitorStates(context.Background(), &capreg.AssembleInput{OwnerID: ""})
	require.Equal(t, []string{"calendar.book"}, stateIDs(noOwner), "no owner context -> not gated")
}

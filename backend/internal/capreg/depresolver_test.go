// depresolver_test.go —— connector 重构 · 依赖 provider 注册表单测。
// 对应 connector-deps-tests.md §一：dep-registry / requires-boot-reject(注册表面) /
// enabledcaps-multi-dep(AllConnected AND) / connected-errors(E1)。

package capreg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
	"github.com/stretchr/testify/require"
)

const calendarDep = "calendar"

func okConnected(context.Context, string) (bool, error) { return true, nil }

// requires-boot-reject —— 一个插件 manifest 声明了 core 给不了的命名依赖
// （Requires 含 "weather"），boot 校验应把它挑出来拒绝（fail-fast）。校验逻辑 =
// 拿真解析出来的 manifest.Requires 去 DepRegistry.Unknown；非空 → 该插件该被拒 + log。
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

	// 依赖全已知 → Unknown 空 → 收。
	ok := []byte(`{"plugins":[
	  {"id":"booking","version":"1","shape":"visitor_only",
	   "transport":{"kind":"stdio","command":"booking-plugin"},
	   "requires":["calendar","smtp"]}
	]}`)
	res2, err := mcpplugin.ParseConfig(ok)
	require.NoError(t, err)
	require.Empty(t, depReg.Unknown(res2.Manifests[0].Requires), "all deps known -> accepted")
}

// fakeProvider —— 测试用命名 provider，连接状态/错误可控。
type fakeProvider struct {
	err       error
	name      string
	connected bool
}

func (p fakeProvider) Name() string { return p.name }
func (p fakeProvider) Connected(context.Context, string) (bool, error) {
	return p.connected, p.err
}

// NamedProvider —— 把 (name, Connected 闭包) 包成 DepProvider，透传 name + ownerID。
// composition root 用它把 connector proxy 的 Connected 注册成命名依赖。
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

// dep-registry —— register → lookup 命中；未知 → not found。
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

// dep-registry —— 重名 → panic（boot 期失败）。
func TestDepRegistry_DuplicatePanics(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep})
	require.PanicsWithValue(t, "capreg: duplicate dep provider calendar", func() {
		r.Register(fakeProvider{name: calendarDep})
	})
}

// requires-boot-reject（注册表面）—— Unknown 把未注册的依赖名挑出来（boot 校验：
// 非空 → 拒绝注册声明它的插件）。
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

// enabledcaps-multi-dep —— AllConnected 是 AND：A 连 B 未连 → false；都连 → true。
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

// enabledcaps-multi-dep —— 依赖名未注册 → false（防御，不当已连）。
func TestDepRegistry_AllConnected_UnknownNameFalse(t *testing.T) {
	t.Parallel()
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep, connected: true})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{calendarDep, "ghost"})
	require.NoError(t, err)
	require.False(t, ok, "unknown dep name → not connected")
}

// connected-errors (E1) —— provider.Connected 返 error → 透传 (false, err)，caller
// 当未连隐藏 + log。
func TestDepRegistry_AllConnected_ProviderError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db read failed")
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: calendarDep, err: sentinel})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{calendarDep})
	require.ErrorIs(t, err, sentinel, "provider error propagates")
	require.False(t, ok, "error → not connected")
}

// fakeVisitorCap —— 最小 visitor-facing cap：VisitorBinding 返真 binding（不隐藏）。depCap
// 嵌它再加 Requires（实现 RequiresDeps）；noReqCap 就是它本身（不实现 RequiresDeps）。
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

// depCap —— 声明 Requires → 受 connector-gate。
type depCap struct {
	fakeVisitorCap

	requires []string
}

func (c depCap) Requires() []string { return c.requires }

// noReqCap —— 不声明 Requires → 永不被 connector-gate。
type noReqCap struct{ fakeVisitorCap }

func stateIDs(states []capreg.CapabilityState) []string {
	out := make([]string, 0, len(states))
	for _, s := range states {
		out = append(out, s.ID)
	}
	return out
}

// regWithCalendar —— 注册一个 cap + 一个 calendar provider。
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

// enabledcaps-connector —— `Requires:[calendar]` 未连 → 不进 enabledCaps（VisitorStates
// 不含）；已连 → 进。这就是 D-2：connector gating 收进 global 单点闸。
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

// connected-errors (E1) 在 enabledCaps 层 —— Connected 返 error → 隐藏（fail-closed）。
func TestEnabledCaps_ConnectorError_Hides(t *testing.T) {
	t.Parallel()
	in := &capreg.AssembleInput{OwnerID: "o1"}
	down := fakeProvider{name: calendarDep, err: errors.New("db down")}
	states := regWithCalendar(calendarBookCap(), down).
		VisitorStates(context.Background(), in)
	require.Empty(t, stateIDs(states), "Connected errored -> hide when uncertain")
}

// enabledcaps-global-override 的「不 gate」边界 ——
//   - cap 不声明 Requires → 永不被 connector-gate（即便 provider 未连）。
//   - 无 owner 上下文（OwnerID 空）→ 无法解析 → 不 gate（present）。
func TestEnabledCaps_ConnectorGate_NotGatedCases(t *testing.T) {
	t.Parallel()
	// 不声明 Requires 的 cap：provider 断也照样在。
	always := noReqCap{fakeVisitorCap{id: "always"}}
	noReq := regWithCalendar(always, fakeProvider{name: calendarDep, connected: false}).
		VisitorStates(context.Background(), &capreg.AssembleInput{OwnerID: "o1"})
	require.Equal(t, []string{"always"}, stateIDs(noReq), "no Requires -> not connector-gated")

	// 有 Requires 但无 owner 上下文：解析不了，不 gate。
	disc := fakeProvider{name: calendarDep, connected: false}
	noOwner := regWithCalendar(calendarBookCap(), disc).
		VisitorStates(context.Background(), &capreg.AssembleInput{OwnerID: ""})
	require.Equal(t, []string{"calendar.book"}, stateIDs(noOwner), "no owner context -> not gated")
}

// depresolver_test.go —— connector 重构 · 依赖 provider 注册表单测。
// 对应 connector-deps-tests.md §一：dep-registry / requires-boot-reject(注册表面) /
// enabledcaps-multi-dep(AllConnected AND) / connected-errors(E1)。
package capreg_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/stretchr/testify/require"
)

// fakeProvider —— 测试用命名 provider，连接状态/错误可控。
type fakeProvider struct {
	name      string
	connected bool
	err       error
}

func (p fakeProvider) Name() string { return p.name }
func (p fakeProvider) Connected(context.Context, string) (bool, error) {
	return p.connected, p.err
}

// dep-registry —— register → lookup 命中；未知 → not found。
func TestDepRegistry_RegisterLookup(t *testing.T) {
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: "calendar", connected: true})

	got, ok := r.Lookup("calendar")
	require.True(t, ok, "registered provider found")
	require.Equal(t, "calendar", got.Name())

	_, ok = r.Lookup("nonexistent")
	require.False(t, ok, "unknown provider not found")
}

// dep-registry —— 重名 → panic（boot 期失败）。
func TestDepRegistry_DuplicatePanics(t *testing.T) {
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: "calendar"})
	require.PanicsWithValue(t, "capreg: duplicate dep provider calendar", func() {
		r.Register(fakeProvider{name: "calendar"})
	})
}

// requires-boot-reject（注册表面）—— Unknown 把未注册的依赖名挑出来（boot 校验：
// 非空 → 拒绝注册声明它的插件）。
func TestDepRegistry_Unknown(t *testing.T) {
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: "calendar"})
	r.Register(fakeProvider{name: "smtp"})

	require.Empty(t, r.Unknown([]string{"calendar", "smtp"}), "all known → empty")
	require.Empty(t, r.Unknown(nil), "no requires → empty")
	require.Equal(t, []string{"weather"}, r.Unknown([]string{"calendar", "weather"}),
		"one unknown name surfaced")
}

// enabledcaps-multi-dep —— AllConnected 是 AND：A 连 B 未连 → false；都连 → true。
func TestDepRegistry_AllConnected_AND(t *testing.T) {
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: "calendar", connected: true})
	r.Register(fakeProvider{name: "smtp", connected: false})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{"calendar", "smtp"})
	require.NoError(t, err)
	require.False(t, ok, "A connected, B not → AND false")

	ok, err = r.AllConnected(context.Background(), "owner-1", []string{"calendar"})
	require.NoError(t, err)
	require.True(t, ok, "only the connected one → true")

	ok, err = r.AllConnected(context.Background(), "owner-1", nil)
	require.NoError(t, err)
	require.True(t, ok, "no requires → not gated (true)")
}

// enabledcaps-multi-dep —— 依赖名未注册 → false（防御，不当已连）。
func TestDepRegistry_AllConnected_UnknownNameFalse(t *testing.T) {
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: "calendar", connected: true})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{"calendar", "ghost"})
	require.NoError(t, err)
	require.False(t, ok, "unknown dep name → not connected")
}

// connected-errors (E1) —— provider.Connected 返 error → 透传 (false, err)，caller
// 当未连隐藏 + log。
func TestDepRegistry_AllConnected_ProviderError(t *testing.T) {
	sentinel := errors.New("db read failed")
	r := capreg.NewDepRegistry()
	r.Register(fakeProvider{name: "calendar", err: sentinel})

	ok, err := r.AllConnected(context.Background(), "owner-1", []string{"calendar"})
	require.ErrorIs(t, err, sentinel, "provider error propagates")
	require.False(t, ok, "error → not connected")
}

// depCap —— 一个 visitor-facing cap，VisitorBinding 返真 binding（不隐藏），可选声明
// Requires（实现 RequiresDeps）。enabledCaps 应据连接状态决定它出不出现。
type depCap struct {
	id       string
	requires []string
}

func (c depCap) ID() string        { return c.id }
func (depCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }
func (c depCap) VisitorBinding(context.Context, *capreg.AssembleInput) (*capreg.Binding, error) {
	return &capreg.Binding{State: capreg.CapabilityState{ID: c.id, Enabled: true}}, nil
}
func (depCap) OwnerMCPBindings() []*capreg.MCPBinding                       { return nil }
func (depCap) SystemPromptFragment(context.Context, *capreg.AssembleInput) string   { return "" }
func (depCap) SystemPromptFragmentID(context.Context, *capreg.AssembleInput) string { return "" }
func (c depCap) Requires() []string                                        { return c.requires }

// noReqCap —— 不声明 Requires（不实现 RequiresDeps）→ 永不被 connector-gate。
type noReqCap struct{ id string }

func (c noReqCap) ID() string        { return c.id }
func (noReqCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }
func (c noReqCap) VisitorBinding(context.Context, *capreg.AssembleInput) (*capreg.Binding, error) {
	return &capreg.Binding{State: capreg.CapabilityState{ID: c.id, Enabled: true}}, nil
}
func (noReqCap) OwnerMCPBindings() []*capreg.MCPBinding                       { return nil }
func (noReqCap) SystemPromptFragment(context.Context, *capreg.AssembleInput) string   { return "" }
func (noReqCap) SystemPromptFragmentID(context.Context, *capreg.AssembleInput) string { return "" }

func stateIDs(states []capreg.CapabilityState) []string {
	out := make([]string, 0, len(states))
	for _, s := range states {
		out = append(out, s.ID)
	}
	return out
}

// regWithCalendar —— 注册一个 `Requires:["calendar"]` 的 cap + 一个 calendar provider。
func regWithCalendar(cap capreg.Capability, p fakeProvider) *capreg.Registry {
	reg := capreg.NewRegistry()
	reg.MustRegister(cap)
	dr := capreg.NewDepRegistry()
	dr.Register(p)
	reg.SetDepRegistry(dr)
	return reg
}

// enabledcaps-connector —— `Requires:[calendar]` 未连 → 不进 enabledCaps（VisitorStates
// 不含）；已连 → 进。这就是 D-2：connector gating 收进 global 单点闸。
func TestEnabledCaps_ConnectorGate(t *testing.T) {
	cap := depCap{id: "calendar.book", requires: []string{"calendar"}}
	in := &capreg.AssembleInput{OwnerID: "o1"}

	hidden := regWithCalendar(cap, fakeProvider{name: "calendar", connected: false}).
		VisitorStates(context.Background(), in)
	require.Empty(t, stateIDs(hidden), "calendar 未连 → cap 隐藏（不进 enabledCaps）")

	shown := regWithCalendar(cap, fakeProvider{name: "calendar", connected: true}).
		VisitorStates(context.Background(), in)
	require.Equal(t, []string{"calendar.book"}, stateIDs(shown), "calendar 已连 → cap 暴露")
}

// connected-errors (E1) 在 enabledCaps 层 —— Connected 返 error → 隐藏（fail-closed）。
func TestEnabledCaps_ConnectorError_Hides(t *testing.T) {
	cap := depCap{id: "calendar.book", requires: []string{"calendar"}}
	in := &capreg.AssembleInput{OwnerID: "o1"}
	states := regWithCalendar(cap, fakeProvider{name: "calendar", err: errors.New("db down")}).
		VisitorStates(context.Background(), in)
	require.Empty(t, stateIDs(states), "Connected 出错 → 不确定就隐藏")
}

// enabledcaps-global-override 的「不 gate」边界 ——
//   - cap 不声明 Requires → 永不被 connector-gate（即便 provider 未连）。
//   - 无 owner 上下文（OwnerID 空）→ 无法解析 → 不 gate（present）。
func TestEnabledCaps_ConnectorGate_NotGatedCases(t *testing.T) {
	// 不声明 Requires 的 cap：provider 断也照样在。
	noReq := regWithCalendar(noReqCap{id: "always"}, fakeProvider{name: "calendar", connected: false}).
		VisitorStates(context.Background(), &capreg.AssembleInput{OwnerID: "o1"})
	require.Equal(t, []string{"always"}, stateIDs(noReq), "无 Requires → 不被 connector-gate")

	// 有 Requires 但无 owner 上下文：解析不了，不 gate。
	cap := depCap{id: "calendar.book", requires: []string{"calendar"}}
	noOwner := regWithCalendar(cap, fakeProvider{name: "calendar", connected: false}).
		VisitorStates(context.Background(), &capreg.AssembleInput{OwnerID: ""})
	require.Equal(t, []string{"calendar.book"}, stateIDs(noOwner), "无 owner → 不 gate")
}

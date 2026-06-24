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

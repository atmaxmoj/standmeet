// registry_collision_test.go —— Phase H / P.5：内建撞名赢。boot 期 builtin 先
// 注册、插件后注册；插件 ID 撞上已注册的 builtin → 注册被拒、builtin 不被影子
// 覆盖（first/builtin wins）。这条 guard 锁死「加 origin 后，撞名解析仍是
// builtin 赢、不被插件 shadow」。
package capreg_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// fakeCap —— 最小 Capability，用 tag 区分「先注册的 builtin」vs「撞名的插件」。
type fakeCap struct {
	id  string
	tag string
}

func (f fakeCap) ID() string        { return f.id }
func (fakeCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }
func (fakeCap) VisitorBinding(_ context.Context, _ *capreg.AssembleInput) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}
func (fakeCap) OwnerMCPBindings() []*capreg.MCPBinding { return []*capreg.MCPBinding{} }
func (fakeCap) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (fakeCap) SystemPromptFragmentID(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func TestCollidingPluginRejected_BuiltinWins(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()

	// boot order: builtin first.
	builtin := fakeCap{id: "calendar.book", tag: "builtin"}
	reg.MustRegister(builtin)

	// a discovered plugin collides on the same ID → must be rejected.
	shadow := fakeCap{id: "calendar.book", tag: "plugin-shadow"}
	require.Error(t, reg.Register(shadow), "colliding plugin registration must be rejected")

	// builtin is not shadowed: exactly one cap with that ID, and it's the builtin.
	matches := make([]fakeCap, 0, 1)
	for _, c := range reg.List() {
		if c.ID() == "calendar.book" {
			fc, ok := c.(fakeCap)
			require.True(t, ok)
			matches = append(matches, fc)
		}
	}
	require.Len(t, matches, 1, "colliding ID must not double-register")
	require.Equal(t, "builtin", matches[0].tag, "builtin wins, not the plugin shadow")
}

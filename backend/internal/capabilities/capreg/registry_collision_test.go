// registry_collision_test.go —— Phase H / P.5: the builtin wins a name collision.
// At boot, builtins register first and plugins register after; a plugin ID that
// collides with an already-registered builtin gets its registration rejected —
// the builtin is never shadowed (first/builtin wins). This guard locks down that,
// after adding origin, collision resolution still favors the builtin and is never
// shadowed by a plugin.
package capreg_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// fakeCap — a minimal Capability, using tag to distinguish "the builtin
// registered first" from "the colliding plugin".
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

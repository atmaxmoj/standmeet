// registry_collision_test.go —— Phase H / P.5: the builtin wins a name collision.
// At boot, builtins register first and plugins register after; a plugin ID that
// collides with an already-registered builtin gets its registration rejected —
// the builtin is never shadowed (first/builtin wins). This guard locks down that,
// after adding origin, collision resolution still favors the builtin and is never
// shadowed by a plugin.
package registry_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// fakeFiber — a minimal Fiber, using tag to distinguish "the builtin
// registered first" from "the colliding plugin".
type fakeFiber struct {
	id  string
	tag string
}

func (f fakeFiber) ID() string          { return f.id }
func (fakeFiber) Shape() registry.Shape { return registry.ShapeVisitorOnly }
func (fakeFiber) VisitorBinding(
	_ context.Context, _ *registry.AssembleInput,
) (*registry.Binding, error) {
	return nil, registry.ErrHidden
}
func (fakeFiber) OwnerMCPBindings() []*registry.MCPBinding { return []*registry.MCPBinding{} }
func (fakeFiber) SystemPromptFragment(_ context.Context, _ *registry.AssembleInput) string {
	return ""
}

func (fakeFiber) SystemPromptFragmentID(_ context.Context, _ *registry.AssembleInput) string {
	return ""
}

func TestCollidingPluginRejected_BuiltinWins(t *testing.T) {
	t.Parallel()
	reg := registry.NewRegistry()

	// boot order: builtin first.
	builtin := fakeFiber{id: "calendar.book", tag: "builtin"}
	reg.MustRegister(builtin)

	// a discovered plugin collides on the same ID → must be rejected.
	shadow := fakeFiber{id: "calendar.book", tag: "plugin-shadow"}
	require.Error(t, reg.Register(shadow), "colliding plugin registration must be rejected")

	// builtin is not shadowed: exactly one cap with that ID, and it's the builtin.
	matches := make([]fakeFiber, 0, 1)
	for _, c := range reg.List() {
		if c.ID() == "calendar.book" {
			fc, ok := c.(fakeFiber)
			require.True(t, ok)
			matches = append(matches, fc)
		}
	}
	require.Len(t, matches, 1, "colliding ID must not double-register")
	require.Equal(t, "builtin", matches[0].tag, "builtin wins, not the plugin shadow")
}

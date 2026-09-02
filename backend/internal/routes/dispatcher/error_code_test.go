package dispatcher_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// TestCodedKeepsItsClass -- pinning a code must not lose the class. A face picks its
// status code by class first, then reads the code; if wrapping breaks IsConflict's
// recognition, 409 degrades to 500.
func TestCodedKeepsItsClass(t *testing.T) {
	t.Parallel()

	err := dispatcher.Coded(dispatcher.Conflict("role name already taken"), "role_name_taken")

	require.True(t, dispatcher.IsConflict(err), "class must survive the code wrapper")
	require.False(t, dispatcher.IsBadInput(err))
	require.Equal(t, "role name already taken", err.Error(), "message is untouched")

	code, ok := dispatcher.CodeOf(err)
	require.True(t, ok)
	require.Equal(t, "role_name_taken", code)
}

// TestUncodedHasNoPinnedCode -- unpinned stays unpinned; a face falls back to the
// class's default code accordingly.
func TestUncodedHasNoPinnedCode(t *testing.T) {
	t.Parallel()

	_, ok := dispatcher.CodeOf(dispatcher.Conflict("something clashed"))
	require.False(t, ok)
}

// TestCodedSurvivesWrapping -- adapters often wrap an error in another fmt.Errorf layer;
// both the code and the class must still be recognizable, otherwise 409/role_name_taken
// silently degrades on its way up.
func TestCodedSurvivesWrapping(t *testing.T) {
	t.Parallel()

	inner := dispatcher.Coded(dispatcher.NotFound("role not found"), "role_not_found")
	wrapped := fmt.Errorf("role op: %w", inner)

	require.True(t, dispatcher.IsNotFound(wrapped))
	code, ok := dispatcher.CodeOf(wrapped)
	require.True(t, ok)
	require.Equal(t, "role_not_found", code)
}

package dispatcher_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// TestCodedKeepsItsClass —— 钉 code 不能把类别弄丢。面先按类别选状态码,再取 code;
// 如果包一层之后 IsConflict 认不出来了,409 就会退成 500。
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

// TestUncodedHasNoPinnedCode —— 没钉过就是没钉过,面据此退到类别的默认 code。
func TestUncodedHasNoPinnedCode(t *testing.T) {
	t.Parallel()

	_, ok := dispatcher.CodeOf(dispatcher.Conflict("something clashed"))
	require.False(t, ok)
}

// TestCodedSurvivesWrapping —— 适配器常把错误再包一层 fmt.Errorf;code 和类别都得还认得出,
// 否则 409/role_name_taken 会在上抛的路上悄悄退化。
func TestCodedSurvivesWrapping(t *testing.T) {
	t.Parallel()

	inner := dispatcher.Coded(dispatcher.NotFound("role not found"), "role_not_found")
	wrapped := fmt.Errorf("role op: %w", inner)

	require.True(t, dispatcher.IsNotFound(wrapped))
	code, ok := dispatcher.CodeOf(wrapped)
	require.True(t, ok)
	require.Equal(t, "role_not_found", code)
}

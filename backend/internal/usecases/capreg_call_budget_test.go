// capreg_call_budget_test.go —— F-A-6: a tool that declares `_meta.long_running` (summarize's
// LLM-backed report generation) is dispatched with LongCallTimeout, not the generic 15s cap that
// times such a call out mid-generation and blanks the inline card.

package usecases

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/mcpclient"
)

func TestToolCallBudget_LongRunning(t *testing.T) {
	t.Parallel()
	long := (&mcpclient.Tool{Name: "summarize_conversation"}).WithMetaFlag("long_running", true)
	require.Equal(t, mcpclient.LongCallTimeout, toolCallBudget(long),
		"a long_running tool must get the long budget")
}

func TestToolCallBudget_DefaultForNormalTool(t *testing.T) {
	t.Parallel()
	for _, tool := range []*mcpclient.Tool{
		{Name: "no-meta"},
		(&mcpclient.Tool{Name: "return-directly"}).WithMetaFlag("return_directly", true),
		(&mcpclient.Tool{Name: "long-running-false"}).WithMetaFlag("long_running", false),
	} {
		require.Zero(t, toolCallBudget(tool),
			"a non-long_running tool must use the default budget (0)")
	}
}

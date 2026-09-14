// mounted_warm_test.go —— tests for the listing path + the spec/UI warm (mounted_warm.go). Split
// out of mounted_test.go to stay under the max-lines ceiling. Reuses that file's helpers
// (buildPluginMock / stdioManifest / grantInput / bindingToolNames / toolUIHTMLByName), same pkg.

package mount

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// listing (VisitorListBinding) after the STARTUP warm: WarmVisitorBlock(ctx) dials synchronously
// and fills the shared cache, so the very first listing binds HOT — full tool list + each ui://
// card, with no dial. This is the boot path: WarmVisitorBlocks runs before the server serves, so no
// session (not even the first) is cold.
func TestMCPApp_ListBinding_WarmThenHot(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true // canonical names (clarify/echo)
	c := newMCPAppFiber(m)
	in := grantInput(echoerID)

	c.WarmVisitorBlock(context.Background()) // synchronous startup warm
	b, err := c.VisitorListBinding(context.Background(), in)
	require.NoError(t, err)
	require.NotNil(t, b)
	require.Contains(t, bindingToolNames(b), "clarify", "listing binds hot after the startup warm")
	require.NotEmpty(t, toolUIHTMLByName(b, "clarify"),
		"the tool's ui:// card is present from the warm cache (not dropped)")
}

// listing (VisitorListBinding) COLD — no startup warm ran (a block registered after boot, or its
// boot warm timed out): the call returns State (dock button) with NO tools and kicks a background
// warm; a later assembly binds hot. It deliberately does not block. This is the self-heal path.
func TestMCPApp_ListBinding_ColdSelfHeals(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true
	c := newMCPAppFiber(m)
	in := grantInput(echoerID)

	cold, err := c.VisitorListBinding(context.Background(), in)
	require.NoError(t, err)
	require.NotNil(t, cold)
	require.NotEmpty(t, cold.State.ID, "cold listing still reports state (dock button)")
	require.Empty(t, cold.Tools, "cold listing exposes no tools until the background warm lands")

	// The kicked background warm fills the cache; a later assembly binds hot.
	require.Eventually(t, func() bool {
		b, e := c.VisitorListBinding(context.Background(), in)
		return e == nil && b != nil &&
			strings.Contains(bindingToolNames(b), "clarify") && toolUIHTMLByName(b, "clarify") != ""
	}, 10*time.Second, 50*time.Millisecond, "tools + ui card appear once the self-heal warm lands")
}

// listing regression guard ([[knownUI]] must not be inferred from the tool-spec cache): the CALL
// path (VisitorBinding) fills `tools` but never `ui`. If listing keyed UI-readiness off `tools`, a
// call before the first listing would make listing report the ui cache "known" while it is EMPTY —
// dropping every card for the rest of the session. With the fix, listing warms the ui cache itself
// and the card eventually appears.
func TestMCPApp_ListBinding_CallPathDoesNotPoisonUICache(t *testing.T) {
	t.Parallel()
	m := stdioManifest(echoerID, buildPluginMock(t))
	m.RawToolNames = true
	c := newMCPAppFiber(m)
	in := grantInput(echoerID)

	// A tool CALL first: this fills the spec cache (tools) but not the ui cache.
	callB, err := c.VisitorBinding(context.Background(), in)
	require.NoError(t, err)
	if callB.Close != nil {
		callB.Close()
	}
	specs, sok := c.knownToolSpecs()
	require.True(t, sok, "the call path cached the specs")
	require.NotEmpty(t, specs)
	_, uok := c.knownUI()
	require.False(t, uok, "the call path must NOT have marked the ui cache ready")

	// Listing must therefore still warm the ui cache and eventually surface clarify's card.
	require.Eventually(t, func() bool {
		b, e := c.VisitorListBinding(context.Background(), in)
		return e == nil && b != nil && toolUIHTMLByName(b, "clarify") != ""
	}, 10*time.Second, 50*time.Millisecond, "ui card appears once listing warms it (not poisoned)")
}

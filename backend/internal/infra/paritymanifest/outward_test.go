package paritymanifest_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	pm "github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
)

// TestOutward_AllOpsArePlaneOutward —— self-consistency: every op in the outward manifest is
// declared PlaneOutward. A mis-tagged owner reach hiding in the outward table would be caught here
// before it could ever be checked against an outward facade.
func TestOutward_AllOpsArePlaneOutward(t *testing.T) {
	t.Parallel()
	for _, op := range pm.ManifestOutward() {
		require.Equalf(t, fp.PlaneOutward, op.Reach.Plane(),
			"outward op %q must be PlaneOutward", op.ID)
	}
}

// TestOutward_APIRatchet —— the api facade ratchet, paid to zero: the renderer's whitelisted tools
// (APIRenderableTools) realize every non-Agentic outward op, so APIMissing over them equals the
// (empty) KnownAPIGaps baseline. Drop a tool from the renderer → APIMissing re-grows → RED. This is
// the same shrink-only contract KnownMCPGaps has on the owner side.
func TestOutward_APIRatchet(t *testing.T) {
	t.Parallel()
	require.ElementsMatch(t, pm.KnownAPIGaps(), pm.APIMissing(pm.APIRenderableTools()),
		"the api renderer must realize exactly the non-Agentic outward ops.\n"+
			"• Dropped a tool from APIRenderableTools? it re-enters APIMissing → restore it.\n"+
			"• Added a non-Agentic outward op? whitelist its tool in apiRenderable.")
}

// TestOutward_AgenticOpsAreNeverRenderable —— an Agentic op (needs an LLM in the loop) can never be
// realized by an api tool: none of the renderable tools maps back to ask / summarize / mail.
func TestOutward_AgenticOpsAreNeverRenderable(t *testing.T) {
	t.Parallel()
	agentic := map[string]bool{pm.OpAsk: true, pm.OpSummarize: true, pm.OpMailSend: true}
	for _, tool := range pm.APIRenderableTools() {
		op, ok := pm.OutwardOpForTool(tool)
		require.True(t, ok, "renderable tool %q must map to an outward op", tool)
		require.Falsef(t, agentic[op], "renderable tool %q maps to Agentic op %q", tool, op)
	}
}

// TestOutward_MCPVisitorRatchet —— the visitor MCP face's ratchet, the same contract as the api
// face: the tool set it renders must realize **every** non-Agentic outward op.
//
// This guards against "a third outward face reporting something different from the first two":
// if a face under-reports one capability, the visitor's AI can never plan a path to it, and
// nothing at compile time will say a word.
func TestOutward_MCPVisitorRatchet(t *testing.T) {
	t.Parallel()
	require.ElementsMatch(t, pm.KnownAPIGaps(), pm.MCPVisitorMissing(pm.APIRenderableTools()),
		"the visitor MCP face must realize exactly the non-Agentic outward ops.\n"+
			"• Mounted it with a narrower list? the dropped ops re-enter → restore them.\n"+
			"• Added a non-Agentic outward op? it must render on every outward face.")
}

// TestOutward_OwnerOpOnMCPVisitorIsLeak —— **this is the actual reason this face is registered.**
//
// The visitor MCP face authenticates with an access code, while the owner face authenticates
// with Sigv1 — the two faces live in the same process, and their mount points differ only by a
// prefix (`/mcp` vs `/mcp/visitor`). The day someone mounts an owner capability onto the visitor
// face, it compiles, tests go green, and the visitor's AI gets a hold of an owner tool. Once this
// face is registered as outward-plane, that becomes a leak.
func TestOutward_OwnerOpOnMCPVisitorIsLeak(t *testing.T) {
	t.Parallel()
	const ownerSample = "writings.save"
	visitor := fp.Facade{
		Name: "mcp-visitor", Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true,
	}
	vs := fp.Conform(pm.AllOps(), []fp.Exposure{
		{Facade: visitor, Exposed: map[string]bool{ownerSample: true}},
	})
	leaked := false
	for _, v := range vs {
		if v.Kind == "leak" && v.OpID == ownerSample {
			leaked = true
		}
	}
	require.Truef(t, leaked,
		"an owner op on the visitor MCP face must be a leak\n%s", fp.Report(vs))
}

// TestOutward_OwnerOpOnAPIFacadeIsLeak —— the integration leak wall: over the combined
// owner+outward manifest (AllOps), an owner op rendered on the api facade is a hard leak. This is
// the real guarantee the whole direction axis exists for: admin capabilities can never render on
// the outward api surface.
func TestOutward_OwnerOpOnAPIFacadeIsLeak(t *testing.T) {
	t.Parallel()
	// Take an owner op **still present in this table** as the sample. corpus.list used to be
	// that sample; once it moved into the corpus domain and vanished from the table, this test
	// degraded into an orphan instead of a leak — the sample has to track the table. The day the
	// table empties, this assertion moves to the convergence point (dispatcher.Conform).
	const ownerSample = "writings.save"
	api := fp.Facade{Name: "api", Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true}
	vs := fp.Conform(pm.AllOps(), []fp.Exposure{
		{Facade: api, Exposed: map[string]bool{ownerSample: true}},
	})
	leaked := false
	for _, v := range vs {
		if v.Kind == "leak" && v.OpID == ownerSample {
			leaked = true
		}
	}
	require.Truef(t, leaked, "owner op on api must be a leak\n%s", fp.Report(vs))
}

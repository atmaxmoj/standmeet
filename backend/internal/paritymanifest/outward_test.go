package paritymanifest_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/facadeparity"
	pm "github.com/atmaxmoj/standmeet/internal/paritymanifest"
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

// TestOutward_OwnerOpOnAPIFacadeIsLeak —— the integration leak wall: over the combined
// owner+outward manifest (AllOps), an owner op rendered on the api facade is a hard leak. This is
// the real guarantee the whole direction axis exists for: admin capabilities can never render on
// the outward api surface.
func TestOutward_OwnerOpOnAPIFacadeIsLeak(t *testing.T) {
	t.Parallel()
	api := fp.Facade{Name: "api", Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true}
	vs := fp.Conform(pm.AllOps(), []fp.Exposure{
		{Facade: api, Exposed: map[string]bool{"corpus.list": true}},
	})
	leaked := false
	for _, v := range vs {
		if v.Kind == "leak" && v.OpID == "corpus.list" {
			leaked = true
		}
	}
	require.Truef(t, leaked, "owner op on api must be a leak\n%s", fp.Report(vs))
}

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

// TestOutward_APIBaselineMatchesMechanism —— the api paydown baseline (KnownAPIGaps) must equal
// EXACTLY the set the mechanism says the api facade must expose but doesn't (its renderer is empty
// today). So the baseline is derived-from-truth, not hand-maintained drift — the same ratchet
// contract KnownMCPGaps has on the owner side.
func TestOutward_APIBaselineMatchesMechanism(t *testing.T) {
	t.Parallel()
	require.ElementsMatch(t, pm.KnownAPIGaps(), pm.APIMissing(nil),
		"KnownAPIGaps must equal the api facade's must-expose set (the non-Agentic outward ops).\n"+
			"• Shipped an api endpoint? delete its op-id from KnownAPIGaps.\n"+
			"• Added a non-Agentic outward op? it joins the baseline until the api renders it.")
}

// TestOutward_AgenticOpsAreNeverAPICandidates —— an Agentic op (needs an LLM in the loop) can never
// enter the api baseline: the brainless facade must not be obligated to carry it.
func TestOutward_AgenticOpsAreNeverAPICandidates(t *testing.T) {
	t.Parallel()
	gaps := map[string]bool{}
	for _, id := range pm.KnownAPIGaps() {
		gaps[id] = true
	}
	for _, id := range []string{pm.OpAsk, pm.OpSummarize, pm.OpMailSend} {
		require.Falsef(t, gaps[id], "Agentic op %q must not be an api candidate", id)
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

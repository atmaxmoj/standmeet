package facadeparity_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// mcp / admin —— two owner-facing facades. Both serve actions + reads; only admin can carry
// browser/secret/multipart flows (MCP can't弹 a browser or traffic raw secrets).
type facadeSet struct{ mcp, admin fp.Facade }

func facades() facadeSet {
	return facadeSet{
		mcp: fp.Facade{Name: "mcp", ServesRead: true, ServesActn: true},
		admin: fp.Facade{
			Name: "admin", ServesRead: true, ServesActn: true,
			CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
		},
	}
}

// TestConform_OmissionIsCaught —— the core proof: a capability wired to admin but NOT mcp goes RED;
// adding the mcp binding goes GREEN. This is "omission is now impossible", mechanically.
func TestConform_OmissionIsCaught(t *testing.T) {
	t.Parallel()
	fs := facades()
	manifest := []fp.Op{{ID: "roles.create", Kind: fp.Action, Reach: fp.OwnerAction()}}

	// RED: admin exposes it, mcp forgot it → a missing violation for mcp.
	red := fp.Conform(manifest, []fp.Exposure{
		{Facade: fs.mcp, Exposed: map[string]bool{}},
		{Facade: fs.admin, Exposed: map[string]bool{"roles.create": true}},
	})
	require.Len(t, red, 1, "an OwnerAction op missing from mcp must be caught\n%s", fp.Report(red))
	require.Equal(t, "mcp", red[0].Facade)
	require.Equal(t, "roles.create", red[0].OpID)
	require.Equal(t, "missing", red[0].Kind)

	// GREEN: both expose it → conformant.
	green := fp.Conform(manifest, []fp.Exposure{
		{Facade: fs.mcp, Exposed: map[string]bool{"roles.create": true}},
		{Facade: fs.admin, Exposed: map[string]bool{"roles.create": true}},
	})
	require.Empty(t, green, "both facades expose it → no violation\n%s", fp.Report(green))
}

// TestConform_OnlyIsRespected —— an Only-pinned (single-surface, with reason) op doesn't fault
// the facades it isn't pinned to.
func TestConform_OnlyIsRespected(t *testing.T) {
	t.Parallel()
	fs := facades()
	manifest := []fp.Op{
		{
			ID: "custom_page.build", Kind: fp.Action,
			Reach: fp.Only("authoring is MCP-only by product decision", "mcp"),
		},
		{
			ID: "account.change_password", Kind: fp.Action,
			Reach: fp.Only("raw secret; admin bootstrap only", "admin"),
		},
	}
	vs := fp.Conform(manifest, []fp.Exposure{
		{Facade: fs.mcp, Exposed: map[string]bool{"custom_page.build": true}},
		{Facade: fs.admin, Exposed: map[string]bool{"account.change_password": true}},
	})
	require.Empty(t, vs, "Only-pinned ops don't fault the other facade\n%s", fp.Report(vs))
}

// TestConform_ExceptSkipsIncapableFacade —— a browser-bound action is NOT required on a facade
// that can't carry Browser (mcp), but IS required on one that can (admin).
func TestConform_ExceptSkipsIncapableFacade(t *testing.T) {
	t.Parallel()
	fs := facades()
	manifest := []fp.Op{
		{
			ID: "connector.oauth_connect", Kind: fp.Action,
			Reach: fp.OwnerAction().Except(fp.Browser),
		},
	}
	// mcp lacks nothing but the Browser class it can't carry → op not required there; admin has it.
	vs := fp.Conform(manifest, []fp.Exposure{
		{Facade: fs.mcp, Exposed: map[string]bool{}},
		{Facade: fs.admin, Exposed: map[string]bool{"connector.oauth_connect": true}},
	})
	require.Empty(t, vs, "browser-bound op only on browser-capable facades\n%s", fp.Report(vs))

	// If admin ALSO drops it → RED (admin can carry Browser, so it's obligated).
	red := fp.Conform(manifest, []fp.Exposure{
		{Facade: fs.admin, Exposed: map[string]bool{}},
	})
	require.Len(t, red, 1)
	require.Equal(t, "admin", red[0].Facade)
}

// TestConform_OrphanIsCaught —— a facade exposing an op the manifest doesn't declare is a
// violation (forces every real route/tool into the one source of truth).
func TestConform_OrphanIsCaught(t *testing.T) {
	t.Parallel()
	fs := facades()
	vs := fp.Conform(nil, []fp.Exposure{
		{Facade: fs.mcp, Exposed: map[string]bool{"undeclared_tool": true}},
	})
	require.Len(t, vs, 1)
	require.Equal(t, "orphan", vs[0].Kind)
	require.Equal(t, "undeclared_tool", vs[0].OpID)
}

// ───────────────────── Wave A: direction (trust planes) ─────────────────────
//
// facade-directions.md: two planes (owner / outward). Owner reaches bind only to owner facades;
// outward reaches only to outward facades; an op exposed on a facade of the WRONG plane is a hard
// "leak" (both directions). The api facade cannot carry Agentic (LLM-in-the-loop) ops.

// outwardSet —— the outward plane. chat carries Agentic (an LLM drives it); api is programmatic
// and cannot. Both serve reads + actions. (A struct, like facadeSet, dodges same-type-results.)
type outwardSet struct{ chat, api fp.Facade }

func outwardFacades() outwardSet {
	return outwardSet{
		chat: fp.Facade{
			Name: "chat", Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true,
			CanCarry: []fp.FacadeClass{fp.Agentic},
		},
		api: fp.Facade{Name: "api", Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true},
	}
}

// TestConform_OwnerReachNeverRequiredOnOutward —— an OwnerRead op is not "missing" from an outward
// facade that doesn't expose it: owner ops don't belong to the outward plane at all.
func TestConform_OwnerReachNeverRequiredOnOutward(t *testing.T) {
	t.Parallel()
	ow := outwardFacades()
	manifest := []fp.Op{{ID: "codes.list", Kind: fp.Read, Reach: fp.OwnerRead()}}
	vs := fp.Conform(manifest, []fp.Exposure{{Facade: ow.api, Exposed: map[string]bool{}}})
	require.Empty(t, vs, "owner op is not required on an outward facade\n%s", fp.Report(vs))
}

// TestConform_OwnerOpOnOutwardFacadeIsLeak —— the leak wall: an owner-plane op ACTUALLY exposed on
// an outward facade is a hard violation (Kind "leak"), not merely "not required". This is the guard
// the whole direction axis exists for: admin capabilities can never render outward.
func TestConform_OwnerOpOnOutwardFacadeIsLeak(t *testing.T) {
	t.Parallel()
	ow := outwardFacades()
	manifest := []fp.Op{{ID: "codes.list", Kind: fp.Read, Reach: fp.OwnerRead()}}
	vs := fp.Conform(manifest, []fp.Exposure{
		{Facade: ow.api, Exposed: map[string]bool{"codes.list": true}},
	})
	require.Len(t, vs, 1, "owner op leaking to an outward facade must be caught\n%s", fp.Report(vs))
	require.Equal(t, "leak", vs[0].Kind)
	require.Equal(t, "api", vs[0].Facade)
	require.Equal(t, "codes.list", vs[0].OpID)
}

// TestConform_OutwardOpOnOwnerFacadeIsLeak —— the wall both ways: an outward op exposed on an owner
// facade is equally a leak.
func TestConform_OutwardOpOnOwnerFacadeIsLeak(t *testing.T) {
	t.Parallel()
	fs := facades()
	manifest := []fp.Op{{ID: "outward.corpus.search", Kind: fp.Query, Reach: fp.OutwardRead()}}
	vs := fp.Conform(manifest, []fp.Exposure{
		{Facade: fs.mcp, Exposed: map[string]bool{"outward.corpus.search": true}},
	})
	require.Len(t, vs, 1)
	require.Equal(t, "leak", vs[0].Kind)
	require.Equal(t, "mcp", vs[0].Facade)
}

// TestConform_OutwardReachRequiredOnOutwardFacades —— an OutwardRead op is required on every
// outward facade that serves reads; a forgetful one goes RED, both exposing it goes GREEN.
func TestConform_OutwardReachRequiredOnOutwardFacades(t *testing.T) {
	t.Parallel()
	ow := outwardFacades()
	manifest := []fp.Op{{ID: "outward.corpus.read", Kind: fp.Read, Reach: fp.OutwardRead()}}

	red := fp.Conform(manifest, []fp.Exposure{
		{Facade: ow.chat, Exposed: map[string]bool{"outward.corpus.read": true}},
		{Facade: ow.api, Exposed: map[string]bool{}},
	})
	require.Len(t, red, 1)
	require.Equal(t, "api", red[0].Facade)
	require.Equal(t, "missing", red[0].Kind)

	green := fp.Conform(manifest, []fp.Exposure{
		{Facade: ow.chat, Exposed: map[string]bool{"outward.corpus.read": true}},
		{Facade: ow.api, Exposed: map[string]bool{"outward.corpus.read": true}},
	})
	require.Empty(t, green, "%s", fp.Report(green))
}

// TestConform_AgenticExceptSkipsAPIFacade —— an Agentic outward op (needs an LLM in the loop) is
// required on chat (carries Agentic) but NOT on api (can't) — the mechanism that keeps
// ask/summarize off the programmatic surface without faulting it.
func TestConform_AgenticExceptSkipsAPIFacade(t *testing.T) {
	t.Parallel()
	ow := outwardFacades()
	manifest := []fp.Op{
		{ID: "outward.ask", Kind: fp.Action, Reach: fp.OutwardAction().Except(fp.Agentic)},
	}
	vs := fp.Conform(manifest, []fp.Exposure{
		{Facade: ow.chat, Exposed: map[string]bool{"outward.ask": true}},
		{Facade: ow.api, Exposed: map[string]bool{}},
	})
	require.Empty(t, vs, "Agentic op required on chat, skipped on api\n%s", fp.Report(vs))
}

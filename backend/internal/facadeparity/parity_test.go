package facadeparity_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	fp "github.com/atmaxmoj/standmeet/internal/facadeparity"
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

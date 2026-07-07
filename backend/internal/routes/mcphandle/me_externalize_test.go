// me_externalize_test.go —— #135 externalization pilot (owner caps off core `MustRegister`).
//
// The externalization is behavior-preserving: the `me` tool's existing owner-MCP e2e stays green
// (parity). So the RED-first artifact can't be a behavior test — it's this STRUCTURAL gate:
// owner.me must NOT be registered by core `mcphandle.RegisterAgentSkills`; it moves out to a plugin
// (the jobs-style in-process CapabilityRegistrar). Full-boot registration + the me e2e prove it
// still works from its new home.
//
// RED before the migration: owner.me is still in RegisterAgentSkills → OriginOf ok=true → fails.
// GREEN after: RegisterAgentSkills no longer registers it → ok=false.
//
// The still-in-core sibling `seo.bundle` MUST stay registered — that guards against a vacuous pass
// (a broken/empty RegisterAgentSkills would also make owner.me absent).

package mcphandle_test

import (
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
)

func TestMe_ExternalizedOffCore(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	mcphandle.RegisterAgentSkills(reg, &mcphandle.RegisterDeps{
		Log:      slog.Default(),
		Calendar: &mcphandle.CalendarOwnerDeps{}, // RegisterAgentSkills derefs .Proxy/.Store
	})

	_, meOK := reg.OriginOf("owner.me")
	require.False(t, meOK,
		"owner.me must be externalized off core mcphandle (registered via the ownercore plugin)")

	// Not-yet-externalized sibling: proves RegisterAgentSkills actually ran + registers owner caps,
	// so the owner.me assertion above is meaningful (not a vacuous empty-registry pass).
	_, seoOK := reg.OriginOf("seo.bundle")
	require.True(t, seoOK,
		"seo.bundle (still core) must stay core-registered — guards a vacuous test")
}

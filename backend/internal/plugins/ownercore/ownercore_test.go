// ownercore_test.go —— #135: the ownercore plugin now registers EVERY owner-MCP capability (they
// all moved off core mcphandle, which no longer has a RegisterAgentSkills). Asserts the full set is
// registered into capreg by the plugin — the structural proof that core is zero-owner-capability,
// the plugin is the single home. Parity (each still WORKS) = the existing owner-MCP e2e suite.

package ownercore_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/plugins/ownercore"
)

// allOwnerCapIDs —— every owner-MCP capability id the plugin owns.
var allOwnerCapIDs = []string{
	"owner.me", "codes.bundle", "seo.bundle",
	"corpus.raw.bundle", "corpus.output.bundle", "corpus.mutations.bundle",
	"corpus.subjectivity.bundle", "appearance.bundle", "chat.bundle",
	"prompts.bundle", "roles.bundle", "mcp_servers.bundle", "skills.bundle",
	"writings.bundle", "custom_page.bundle", "page.bundle", "calendar.bundle",
	"ip_bans.bundle", "domains.bundle", "access_requests.bundle",
	"capabilities.bundle", "instance.bundle", "connectors.bundle",
	"marketplace.bundle", "booking.bundle", "account.bundle",
	"byoai.bundle", "ai_provider.bundle",
}

func TestPlugin_RegistersAllOwnerCaps(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	// Calendar is a *CalendarOwnerDeps the ctor dereferences; other nil deps are fine (ctors just
	// store, handlers aren't called here).
	p := ownercore.New(&ownercore.Deps{Calendar: &ownercore.CalendarOwnerDeps{}})
	p.RegisterCapabilities(reg)

	for _, id := range allOwnerCapIDs {
		_, ok := reg.OriginOf(id)
		require.Truef(t, ok, "ownercore plugin must register %s into capreg", id)
	}
	require.Len(t, reg.List(), len(allOwnerCapIDs), "plugin registers exactly the owner-cap set")
}

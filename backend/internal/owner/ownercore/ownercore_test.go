// ownercore_test.go —— #135: the ownercore plugin now registers EVERY owner-MCP capability (they
// all moved off core mcphandle, which no longer has a RegisterAgentSkills). Asserts the full set is
// registered into capreg by the plugin — the structural proof that core is zero-owner-capability,
// the plugin is the single home. Parity (each still WORKS) = the existing owner-MCP e2e suite.

package ownercore_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/owner/ownercore"
)

// allOwnerCapIDs —— every owner-MCP capability id the plugin STILL owns.
//
// 这份清单是 ownercore 解散的**进度账**,而且**只能变短**:每把一个资源搬进出站收口
// (internal/routes/dispatcher),就从这里删掉一行;删到空,ownercore 整包删除。
// 变长 = 又往这个跨域包里塞东西,评审时该被拦下。
//
// 已搬走(→ internal/routes/dispatcher):ip_bans、domains、access_requests、
// skills、marketplace、prompts、mcp_servers、roles。
var allOwnerCapIDs = []string{
	"owner.me", "codes.bundle", "seo.bundle",
	"corpus.raw.bundle", "corpus.output.bundle", "corpus.mutations.bundle",
	"corpus.subjectivity.bundle", "appearance.bundle", "chat.bundle",
	"writings.bundle",
	"custom_page.bundle", "page.bundle", "calendar.bundle",
	"capabilities.bundle", "instance.bundle", "connectors.bundle",
	"booking.bundle", "account.bundle",
	"byoai.bundle", "ai_provider.bundle", "api_keys.bundle",
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

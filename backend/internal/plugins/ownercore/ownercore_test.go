// ownercore_test.go —— the pilot's positive half: the plugin registers owner.me into capreg.
// mcphandle's me_externalize_test asserts the negative (core no longer registers it). Together they
// pin the externalization: me LEFT core AND LANDED in the plugin; the me owner-MCP e2e proves it
// still works from its new home.

package ownercore_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/plugins/ownercore"
)

func TestPlugin_RegistersMe(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	ownercore.New(ownercore.Deps{}).RegisterCapabilities(reg)

	_, ok := reg.OriginOf("owner.me")
	require.True(t, ok, "ownercore plugin must register owner.me into capreg")
}

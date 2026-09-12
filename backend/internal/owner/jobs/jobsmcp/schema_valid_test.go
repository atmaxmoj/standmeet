package jobsmcp_test

import (
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmcp"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// TestJobsMCPSchemasAreValidJSON — the InputSchema of all three owner-MCP tool sets
// (jobs/resume/applications) must be valid JSON. They sit in the same live tools/list
// as the built-in owner tools, so one bad schema equally makes mcp-go's serialization
// of the whole table fail → real clients discover zero tools.
// Same guard as internal/mcp's TestOwnerToolSchemasAreValidJSON, covering the plugin side.
func TestJobsMCPSchemasAreValidJSON(t *testing.T) {
	t.Parallel()

	log := slog.Default()
	fibers := []registry.Fiber{
		jobsmcp.NewJobsFiber(nil, log),
		jobsmcp.NewResumeFiber(nil, log),
		jobsmcp.NewApplicationsFiber(nil, log),
	}
	for _, c := range fibers {
		assertSchemasValid(t, c)
	}
}

func assertSchemasValid(t *testing.T, c registry.Fiber) {
	t.Helper()
	for _, b := range c.OwnerMCPBindings() {
		if len(b.InputSchema) == 0 {
			continue
		}
		if !json.Valid(b.InputSchema) {
			t.Errorf("tool %q (block %s) has INVALID InputSchema JSON:\n%s",
				b.Name, c.ID(), string(b.InputSchema))
		}
	}
}

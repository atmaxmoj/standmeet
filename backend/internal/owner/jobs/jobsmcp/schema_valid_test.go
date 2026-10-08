package jobsmcp_test

import (
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmcp"
)

// TestJobsMCPSchemasAreValidJSON — the InputSchema of every job-loop owner tool (jobs / resume /
// assistant / applications) must be valid JSON. They sit in the same live tools/list as the
// built-in owner tools, so one bad schema equally makes mcp-go's serialization of the whole table
// fail → real clients discover zero tools.
func TestJobsMCPSchemasAreValidJSON(t *testing.T) {
	t.Parallel()

	log := slog.Default()
	ops := append(jobsmcp.OwnerOps(nil, nil, nil, log), jobsmcp.ApplicationOps(nil, log)...)
	for i := range ops {
		if len(ops[i].InputSchema) > 0 && !json.Valid(ops[i].InputSchema) {
			t.Errorf("op %q has INVALID InputSchema JSON:\n%s",
				ops[i].ID, string(ops[i].InputSchema))
		}
	}
}

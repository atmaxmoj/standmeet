package jobsmcp_test

import (
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmcp"
)

// TestJobsMCPSchemasAreValidJSON —— jobs/resume/applications 三套 owner-MCP 工具的
// InputSchema 必须是合法 JSON。它们和内建 owner 工具同在 live tools/list,一个坏
// schema 同样会让 mcp-go 序列化整张表失败 → 真实客户端发现不到任何工具。
// 与 internal/mcp 的 TestOwnerToolSchemasAreValidJSON 同一道守护,覆盖插件侧。
func TestJobsMCPSchemasAreValidJSON(t *testing.T) {
	t.Parallel()

	log := slog.Default()
	caps := []capreg.Capability{
		jobsmcp.NewJobsCapability(nil, log),
		jobsmcp.NewResumeCapability(nil, log),
		jobsmcp.NewApplicationsCapability(nil, log),
	}
	for _, c := range caps {
		assertSchemasValid(t, c)
	}
}

func assertSchemasValid(t *testing.T, c capreg.Capability) {
	t.Helper()
	for _, b := range c.OwnerMCPBindings() {
		if len(b.InputSchema) == 0 {
			continue
		}
		if !json.Valid(b.InputSchema) {
			t.Errorf("tool %q (cap %s) has INVALID InputSchema JSON:\n%s",
				b.Name, c.ID(), string(b.InputSchema))
		}
	}
}

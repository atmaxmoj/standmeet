package mcphandle_test

import (
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
)

// TestOwnerToolSchemasAreValidJSON —— 每个 owner-MCP 工具的 InputSchema 必须是
// 合法 JSON。一个坏 schema 会让 mcp-go 在 tools/list 序列化整张表时 MarshalJSON
// 失败 → 返空 body → 真实 MCP 客户端(Claude Desktop)一个工具都发现不了。
// 这条守护把那类 bug 挡在编译期之后、上线之前。
func TestOwnerToolSchemasAreValidJSON(t *testing.T) {
	t.Parallel()

	reg := capreg.NewRegistry()
	mcphandle.RegisterAgentSkills(reg, &mcphandle.RegisterDeps{
		Log:      slog.Default(),
		Calendar: &mcphandle.CalendarOwnerDeps{}, // RegisterAgentSkills derefs .Proxy/.Store
	})

	for _, b := range reg.OwnerMCPBindings() {
		if len(b.InputSchema) == 0 {
			continue
		}
		if !json.Valid(b.InputSchema) {
			t.Errorf("tool %q has INVALID InputSchema JSON:\n%s",
				b.Name, string(b.InputSchema))
		}
	}
}

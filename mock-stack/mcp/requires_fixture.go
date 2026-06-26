// requires_fixture.go —— 声明一个带 `_meta.requires:[calendar]` 的 tool，给 ext-mcp
// connector-dep 测试用：host 读 ext-mcp tool 的 connector 依赖声明，默认**不**自动注入
// （最低信任），owner 显式授权 dep-grant 后才解析暴露。跟 returnDirectly/ui_resource 那套
// _meta 透传同机制；单独成文件，不往 main 堆。

package main

import mcpgo "github.com/mark3labs/mcp-go/mcp"

// needsCalendarTool —— tool needs_calendar，_meta.requires=["calendar"]。visitor 侧
// 暴露成 ext_<server>_needs_calendar；未授权 dep-grant 时该工具不出现。
func needsCalendarTool() mcpgo.Tool {
	t := mcpgo.NewTool(
		"needs_calendar",
		mcpgo.WithDescription("Declares a connector dep via _meta.requires:[calendar]. Fixture."),
		mcpgo.WithString("text", mcpgo.Required(), mcpgo.Description("text to echo")),
	)
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"requires": []any{"calendar"},
	})
	return t
}

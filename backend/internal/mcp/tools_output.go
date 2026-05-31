// tools_output.go —— Phase E-2 之前承载 promote_wiki_to_output +
// list_recent_output 的 srv.AddTool 实现。两个工具已迁到 cap_corpus_output.go
// (Capability + adapter)。本文件保留为占位 (内容空)；E-14 收尾全删 wrapTool
// 时再一并清。
//
// readPromoteOpts (tools_promote.go) 也只剩 capability 内联使用，
// 老路径 (runPromote / runPromoteToOutput) 都已删，对应的 helper
// 也一起在 E-2 期间清理。

package mcp

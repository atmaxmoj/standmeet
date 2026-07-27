// titled.go —— #109/#110 dock 按钮 label 的透传接口。

package capreg

// Titled —— 可选接口：能力暴露一个人类可读 title（MCP 标准 title/annotations.title）。
// 实现它的能力会在 CapabilityState.Title 里透出去；没实现 → 空（无 id 兜底）。
type Titled interface {
	Title() string
}

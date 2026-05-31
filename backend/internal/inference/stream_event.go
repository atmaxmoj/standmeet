// stream_event.go —— Phase D StreamSingleTurn 的事件 + tool_call 类型。
// 跟 SSE wire 一一对应；前端 pi-agent-core 把它解出来跑 agent loop。
// 从 provider.go 拆出来让那边公开结构 ≤ 5 个 (max-public-structs lint)。

package inference

// StreamEvent —— 单轮 LLM 输出的事件流元素 (text delta / tool_use / done /
// error)。
type StreamEvent struct {
	Err      error
	ToolCall *StreamToolCall
	Type     string // "text" | "tool_call" | "done" | "error"
	Text     string // type=="text" 时的 delta；其他类型空
	Stop     string // type=="done" 时的 stop_reason (end_turn / tool_use / max_tokens)
}

// StreamToolCall —— LLM 想调的 tool。Input 是 raw JSON (跟 tool 的
// input_schema 对应)。ID 是 LLM 给的 tool_use id，pi-agent-core 把它
// 回填到 tool_result 配对。
type StreamToolCall struct {
	ID    string
	Name  string
	Input []byte // raw JSON args
}

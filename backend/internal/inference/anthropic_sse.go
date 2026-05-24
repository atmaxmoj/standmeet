// anthropic_sse.go —— Anthropic agent SSE 事件解析。
//
// 收到的 SSE 形如：
//   event: content_block_start
//   data: {"type":"content_block_start","index":N,"content_block":{...}}
//   event: content_block_delta
//   data: {"type":"content_block_delta","index":N,"delta":{...}}
//   event: content_block_stop
//   data: {...}
//   event: message_delta
//   data: {"type":"message_delta","delta":{"stop_reason":"..."},"usage":{...}}
//   event: message_stop
//   data: {...}
//
// 我们只关心 data 行。每个 content block 按 index 追踪状态：
//   • text block: text_delta 文本 → emit Chunk{Text} 给 caller + 累积本 block
//   • tool_use block: input_json_delta partial_json → 累积到 block.input
// message_delta 抓 stop_reason。message_stop 之后 finalize 所有 block。

package inference

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"
)

const (
	sseDataPrefix = "data:"
	blockTypeText = "text"
	blockTypeTool = "tool_use"
)

type anthropicSSEEvent struct {
	Type         string                `json:"type"`
	ContentBlock anthropicSSEBlockInit `json:"content_block"`
	Delta        anthropicSSEDelta     `json:"delta"`
	Index        int                   `json:"index"`
}

type anthropicSSEBlockInit struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

type anthropicSSEDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	PartialJSON string `json:"partial_json"`
	StopReason  string `json:"stop_reason"`
}

// partialBlock —— 一个 content block 累积期的状态。
type partialBlock struct {
	kind  string
	id    string
	name  string
	text  strings.Builder
	input strings.Builder
}

// AgentTurnResult —— 一次 agent turn streaming 解析完的产物。
// Blocks 含 finalized text + tool_use（input 累积好）；StopReason 来自
// message_delta。改成 struct 避免 3-return 触发 revive function-result-limit。
type AgentTurnResult struct {
	StopReason string
	Blocks     []anthropicABlock
}

// parseAnthropicAgentSSE —— 读 SSE 流直到 message_stop 或 EOF；返当前
// turn finalized blocks + stop_reason。text deltas 实时 emit 给 out。
func parseAnthropicAgentSSE(body io.Reader, out chan<- Chunk) (*AgentTurnResult, error) {
	state := &sseState{blocks: map[int]*partialBlock{}}
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, anthropicStreamBufBytes), anthropicStreamBufBytes)
	for sc.Scan() {
		if stopped := dispatchSSELine(sc.Text(), state, out); stopped {
			break
		}
	}
	if serr := sc.Err(); serr != nil {
		return nil, fmt.Errorf("anthropic sse scan: %w", serr)
	}
	return &AgentTurnResult{
		Blocks: finalizeBlocks(state.blocks), StopReason: state.stopReason,
	}, nil
}

// dispatchSSELine —— 一行 SSE：非 data 行 / 空 data 跳过；data 解析后路由
// 到 applySSEEvent。返 true 表流终止。
func dispatchSSELine(line string, state *sseState, out chan<- Chunk) bool {
	if !strings.HasPrefix(line, sseDataPrefix) {
		return false
	}
	data := strings.TrimSpace(strings.TrimPrefix(line, sseDataPrefix))
	if data == "" {
		return false
	}
	return applySSEEvent(data, state, out)
}

// sseState —— stream-parser 累积状态。blocks 按 index 跟 content block 状态。
type sseState struct {
	blocks     map[int]*partialBlock
	stopReason string
}

// applySSEEvent —— 一行 data 解码 + 路由。返 true 表 stream 终止 (message_stop)。
func applySSEEvent(data string, state *sseState, out chan<- Chunk) bool {
	var ev anthropicSSEEvent
	if err := json.Unmarshal([]byte(data), &ev); err != nil {
		return false
	}
	if ev.Type == "message_stop" {
		return true
	}
	handleSSEEventType(&ev, state, out)
	return false
}

func handleSSEEventType(ev *anthropicSSEEvent, state *sseState, out chan<- Chunk) {
	switch ev.Type {
	case "content_block_start":
		startBlock(state, ev)
	case "content_block_delta":
		applyBlockDelta(state.blocks[ev.Index], &ev.Delta, out)
	case "message_delta":
		captureStopReason(state, ev.Delta.StopReason)
	default:
		// message_start / content_block_stop / ping —— 不需要状态变更。
	}
}

func startBlock(state *sseState, ev *anthropicSSEEvent) {
	state.blocks[ev.Index] = &partialBlock{
		kind: ev.ContentBlock.Type, id: ev.ContentBlock.ID, name: ev.ContentBlock.Name,
	}
}

func captureStopReason(state *sseState, reason string) {
	if reason != "" {
		state.stopReason = reason
	}
}

// applyBlockDelta —— text_delta emit 给 caller + 累积；input_json_delta 累积。
func applyBlockDelta(b *partialBlock, d *anthropicSSEDelta, out chan<- Chunk) {
	if b == nil {
		return
	}
	switch d.Type {
	case "text_delta":
		emitTextDelta(b, d.Text, out)
	case "input_json_delta":
		_, _ = b.input.WriteString(d.PartialJSON)
	default:
		// signature_delta / 其他类型当前用不上。
	}
}

func emitTextDelta(b *partialBlock, text string, out chan<- Chunk) {
	if text == "" {
		return
	}
	out <- Chunk{Text: text}
	_, _ = b.text.WriteString(text)
}

// finalizeBlocks —— 按 index asc 排序，转成 anthropicABlock。
// tool_use 的 input 是 partial_json 拼起来的；空 input → "{}" (Anthropic
// 收 tool_result 时 echo 的 input 字段，但我们只送 tool_result 不送 input
// 所以这里其实只用于本地 ExecuteTool 调用)。
func finalizeBlocks(blocks map[int]*partialBlock) []anthropicABlock {
	keys := make([]int, 0, len(blocks))
	for k := range blocks {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	out := make([]anthropicABlock, 0, len(keys))
	for _, k := range keys {
		out = append(out, materializeBlock(blocks[k]))
	}
	return out
}

func materializeBlock(b *partialBlock) anthropicABlock {
	block := anthropicABlock{Type: b.kind, ID: b.id, Name: b.name}
	switch b.kind {
	case blockTypeText:
		block.Text = b.text.String()
	case blockTypeTool:
		input := b.input.String()
		if input == "" {
			input = "{}"
		}
		block.Input = json.RawMessage(input)
	default:
		// 未识别类型，保持空 block，仍按 type 提交给 Anthropic 不报错。
	}
	return block
}

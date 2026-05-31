// anthropic_single_turn.go —— Phase D: StreamSingleTurn for AnthropicProvider。
//
// Re-uses agentTurnStream (一次 streaming 请求 + SSE parse 返
// AgentTurnResult) 但不进 agent loop —— 把 result.Blocks 里的
// tool_use block 直接当 tool_call event emit 给 caller。text delta
// 在 SSE 期间已经 emit 到一个 chunk channel；本 method 把它转成
// StreamEvent。

package inference

import (
	"context"
	"errors"
)

// StreamSingleTurn —— Provider interface 新方法。req.ExecuteTool 忽略。
func (a *AnthropicProvider) StreamSingleTurn(
	ctx context.Context, req *ChatRequest,
) (<-chan StreamEvent, error) {
	out := make(chan StreamEvent, anthropicStreamChanBuf)
	go a.runSingleTurn(ctx, req, out)
	return out, nil
}

func (a *AnthropicProvider) runSingleTurn(
	ctx context.Context, req *ChatRequest, out chan<- StreamEvent,
) {
	defer close(out)
	msgs := initialAgentMessages(req)
	tools := convertToolSpecs(req.Tools)
	chunkCh := make(chan Chunk, anthropicStreamChanBuf)
	// agentTurnStream 把 text deltas emit 到 chunkCh；我们 fan-out 到
	// StreamEvent channel。tool_use blocks 在 AgentTurnResult.Blocks 里。
	go forwardChunksAsText(ctx, chunkCh, out)
	turn, err := a.agentTurnStream(ctx, req, msgs, tools, chunkCh)
	if err != nil {
		out <- StreamEvent{Type: "error", Err: err}
		return
	}
	if turn == nil {
		out <- StreamEvent{Type: "error", Err: errors.New("anthropic: nil turn result")}
		return
	}
	emitToolUseEvents(ctx, out, turn.Blocks)
	emitDoneEvent(ctx, out, turn.StopReason)
}

func forwardChunksAsText(
	ctx context.Context, in <-chan Chunk, out chan<- StreamEvent,
) {
	for chunk := range in {
		if !forwardOneChunk(ctx, &chunk, out) {
			return
		}
	}
}

// forwardOneChunk —— 推一个 chunk；返 false = ctx done，调用方退出。
func forwardOneChunk(
	ctx context.Context, chunk *Chunk, out chan<- StreamEvent,
) bool {
	ev, skip := chunkToStreamEvent(chunk)
	if skip {
		return true
	}
	select {
	case <-ctx.Done():
		return false
	case out <- ev:
		return true
	}
}

func chunkToStreamEvent(chunk *Chunk) (StreamEvent, bool) {
	if chunk.Error != nil {
		return StreamEvent{Type: "error", Err: chunk.Error}, false
	}
	if chunk.Text == "" {
		return StreamEvent{}, true
	}
	return StreamEvent{Type: "text", Text: chunk.Text}, false
}

func emitToolUseEvents(
	ctx context.Context, out chan<- StreamEvent, blocks []anthropicABlock,
) {
	for i := range blocks {
		if blocks[i].Type != "tool_use" {
			continue
		}
		call := &StreamToolCall{
			ID:    blocks[i].ID,
			Name:  blocks[i].Name,
			Input: []byte(blocks[i].Input),
		}
		select {
		case <-ctx.Done():
			return
		case out <- StreamEvent{Type: "tool_call", ToolCall: call}:
		}
	}
}

func emitDoneEvent(ctx context.Context, out chan<- StreamEvent, stop string) {
	if stop == "" {
		stop = "end_turn"
	}
	select {
	case <-ctx.Done():
	case out <- StreamEvent{Type: "done", Stop: stop}:
	}
}

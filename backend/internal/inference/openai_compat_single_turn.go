// openai_compat_single_turn.go —— Phase D: StreamSingleTurn for
// OpenAICompatProvider。复用 agentTurnOnce (non-streaming 一次 POST)
// 把 content 当 text emit + assistant.tool_calls 当 tool_call event emit。

package inference

import (
	"context"
	"errors"
)

// StreamSingleTurn —— Provider interface 新方法。req.ExecuteTool 忽略。
func (p *OpenAICompatProvider) StreamSingleTurn(
	ctx context.Context, req *ChatRequest,
) (<-chan StreamEvent, error) {
	out := make(chan StreamEvent, openAIStreamChanBuf)
	go p.runSingleTurnOA(ctx, req, out)
	return out, nil
}

func (p *OpenAICompatProvider) runSingleTurnOA(
	ctx context.Context, req *ChatRequest, out chan<- StreamEvent,
) {
	defer close(out)
	msgs := initialOpenAIMessages(req)
	tools := convertOpenAITools(req.Tools)
	chunkCh := make(chan Chunk, openAIStreamChanBuf)
	go forwardChunksAsText(ctx, chunkCh, out)
	turn, err := p.agentTurnOnce(ctx, req, msgs, tools, chunkCh)
	close(chunkCh) // forwardChunksAsText exits; safe since agentTurnOnce closes nothing
	if err != nil {
		out <- StreamEvent{Type: "error", Err: err}
		return
	}
	if turn == nil {
		out <- StreamEvent{Type: "error", Err: errors.New("openai: nil turn result")}
		return
	}
	emitOAToolCallEvents(ctx, out, turn.Assistant.ToolCalls)
	emitDoneEvent(ctx, out, openAIFinishToStopReason(turn.FinishReason))
}

func emitOAToolCallEvents(
	ctx context.Context, out chan<- StreamEvent, calls []oaToolCall,
) {
	for i := range calls {
		call := &StreamToolCall{
			ID:    calls[i].ID,
			Name:  calls[i].Function.Name,
			Input: []byte(calls[i].Function.Arguments),
		}
		select {
		case <-ctx.Done():
			return
		case out <- StreamEvent{Type: "tool_call", ToolCall: call}:
		}
	}
}

func openAIFinishToStopReason(finish string) string {
	if finish == openAIFinishToolCalls {
		return "tool_use"
	}
	if finish == "" {
		return "end_turn"
	}
	return finish
}

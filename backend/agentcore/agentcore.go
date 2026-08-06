// Package agentcore is the public facade over the backend's transport-
// agnostic agentic loop (internal/inference). It exists so out-of-module
// stacks — notably the eval-harness — can drive the exact same eino ADK
// loop the HTTP path runs, injecting their own AgentSink, without reaching
// into internal/.
//
// The loop body lives in internal/inference (agent_loop.go); prod wires it
// to a browser SSE sink (RunAgentTurn), eval wires it to a transcript sink.
// This facade re-exports only the pieces a driver needs — the event sink
// interface, the per-turn input shapes, and build/drive entry points — as
// thin aliases + pass-throughs. No behaviour lives here; it's a boundary.
package agentcore

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/cloudwego/eino/adk"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
)

// Re-exported types. These are aliases (=), not new definitions, so a
// *agentcore.AgentTurnInput IS an *inference.AgentTurnInput — no conversion
// at the boundary, and an AgentSink implemented against agentcore satisfies
// the loop's internal interface directly.
type (
	// AgentSink is the loop's event output port. A driver implements it to
	// receive text deltas, tool start/complete, suggestions, errors, done.
	AgentSink = inference.AgentSink
	// AgentTurnInput packs one turn's cred + request + tools + labels.
	AgentTurnInput = inference.AgentTurnInput
	// AgentTurnRequest is the system + user_message + history for a turn.
	AgentTurnRequest = inference.AgentTurnRequest
	// Cred is a resolved upstream LLM credential (provider/key/endpoint/model).
	// A driver builds this directly (e.g. from env) instead of via the DB
	// resolver that the HTTP path uses.
	Cred = inference.Cred
	// ChatRequestMsg is a pi-style flat message; AgentTurnRequest.History is
	// a slice of these.
	ChatRequestMsg = inference.ChatRequestMsg
)

// CompactionLogMsg —— 上下文压缩真触发时内核打的那一行。eval 靠它断言压缩发生过,所以
// 那句话只有一份:改名的时候两边一起变,而不是留下一条永远不会绿的断言。
const CompactionLogMsg = inference.CompactionLogMsg

// NewAgentDocContext builds the visitor's current-doc context (title/path/genre)
// for AgentTurnRequest.DocContext. A constructor (not a type alias) so the facade
// doesn't bump its public-struct count; drivers set it on the request to give the
// agent referent resolution ("this page" → that doc).
func NewAgentDocContext(title, path, genre string) *inference.AgentDocContext {
	return &inference.AgentDocContext{Title: title, Path: path, Genre: genre}
}

// Generate runs a single non-streaming completion (no tools, no agent loop) —
// the same call the backend uses for follow-up suggestions and the
// summarize_conversation report. A driver uses it to back LLM-driven fixture
// tools (e.g. an eval of summarize) without reaching into internal/. Takes
// system + messages directly so the facade needn't export the ChatRequest type.
func Generate(
	ctx context.Context, cred *Cred, system string, messages []ChatRequestMsg,
) (string, error) {
	req := &inference.ChatRequest{System: system, Messages: messages}
	out, err := inference.Generate(ctx, cred, req)
	if err != nil {
		return "", fmt.Errorf("agentcore: %w", err)
	}
	return out, nil
}

// BuildAgentIterator builds the eino ADK event iterator (pre-stream): chat
// model + summarization middleware + ChatModelAgent + runner. Failures
// (cred / model build / message parse) return before any event is emitted,
// so the caller decides how to surface them (HTTP status vs transcript line).
func BuildAgentIterator(
	ctx context.Context, in *AgentTurnInput,
) (*adk.AsyncIterator[*adk.AgentEvent], error) {
	iter, err := inference.BuildAgentIterator(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("agentcore: %w", err)
	}
	return iter, nil
}

// DriveAgentLoop consumes the iterator into sink and runs turn teardown
// (follow-up suggestions for code-mode, then Done). HTTP-free.
func DriveAgentLoop(
	ctx context.Context, log *slog.Logger,
	in *AgentTurnInput, iter *adk.AsyncIterator[*adk.AgentEvent], sink AgentSink,
) {
	inference.DriveAgentLoop(ctx, log, in, iter, sink)
}

// RunAgentLoop is the build+drive convenience combo for drivers that don't
// need to interleave their own pre-stream error handling. A build error is
// returned as-is; once driving starts, every outcome (text, tools, error,
// done) flows through sink.
func RunAgentLoop(
	ctx context.Context, log *slog.Logger, in *AgentTurnInput, sink AgentSink,
) error {
	iter, err := BuildAgentIterator(ctx, in)
	if err != nil {
		return err
	}
	DriveAgentLoop(ctx, log, in, iter, sink)
	return nil
}

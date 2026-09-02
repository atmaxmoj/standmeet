// agent_loop.go —— transport-agnostic agentic core. Decouples the H.9 eino ADK agent loop from
// HTTP/SSE:
//
//   - BuildAgentIterator —— pre-stream: builds the chat model + summarization mw + ADK
//     ChatModelAgent + runner, returns the event iterator.
//   - DriveAgentLoop     —— consumes the iterator, feeds events into an AgentSink; at the end
//     runs H.13 follow-up ghosts + Done. Never touches http.
//
// prod (RunAgentTurn) injects sseSink to write pi SSE to the browser; eval-harness injects a
// transcript sink to audit real behavior. The loop is shared verbatim — AgentSink is the only
// injection point (corresponds to the EventObserver port on agent-core in the original D/F
// design, just landed on the backend's Go loop).

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/adk/middlewares/summarization"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// CompactionLogMsg —— the line logged when compaction actually fires.
//
// **Exported as a constant** because eval greps for it to assert "compaction happened": on
// 2026-07-25 this string changed from "context summarized" to the current text, and the eval
// side's grep wasn't updated along with it — that assertion became permanently unable to go
// green, with nothing to alert you. A rename alone can permanently break a test, which is
// exactly why that string must not have a second copy.
const CompactionLogMsg = "agent turn: context compacted"

// contextTokenThreshold —— H.9b: the trigger threshold for ChatModelAgent's summarization
// middleware. Per [[feedback-no-anthropic-assumption]], pick a conservative number for the
// smallest viable provider: DeepSeek-V3 64K / GPT-4o 128K / Claude 200K all have headroom;
// Llama 8K local compacts earlier but never hits the provider ceiling.
const contextTokenThreshold = 32000

// AgentSink —— the agent loop's event outlet (observer). The loop only programs against this
// interface, unaware whether it runs inside an http handler or an eval-harness process:
//
//   - prod: sseSink (agent_turn.go) writes each event as a pi SSE frame to the browser
//   - eval: the harness supplies a transcript sink, prints / logs JSONL to audit prompt +
//     behavior
//
// Method semantics map one-to-one to pi SSE events; progressLabel is looked up and passed in by
// the caller (H.11 throbber copy) — the sink doesn't look it up itself.
type AgentSink interface {
	Text(delta string)
	ToolStarted(id, name, progressLabel string, args json.RawMessage)
	ToolCompleted(name, result string)
	// Ghost —— ghost-steering P4: the **single** steering ghost frame the policy produces after
	// done (the only ghost channel; the old multi-frame followup Ghosts is gone).
	Epilogue(f *EpilogueFrame)
	// Retrying —— called when the transport retries a transient LLM failure once (attempt
	// counts from 1). The prod sink emits a `retrying` SSE frame so the throbber shows
	// "retrying"; it clears naturally once progress resumes (the next text/tool event).
	Retrying(attempt int)
	Error(err error)
	Done(stop string)
}

// loopEmit —— a small bundle (log + sink + labels) shared across the consume chain, to avoid a
// too-many-args signature (revive's 5-arg cap). labels is looked up by emitToolStarted for
// progress_label.
type loopEmit struct {
	log    *slog.Logger
	sink   AgentSink
	in     *AgentTurnInput // for the max-iterations tool-less fallback
	labels map[string]string
}

// BuildAgentIterator —— pre-stream: builds the chat model + summarization mw + ADK
// ChatModelAgent + runner, returns the event iterator. A failure (cred / model build / msg
// parsing) returns before any event is written, leaving it to the caller how to report it (HTTP
// status vs transcript).
func BuildAgentIterator(
	ctx context.Context, in *AgentTurnInput,
) (*adk.AsyncIterator[*adk.AgentEvent], error) {
	cm, err := BuildChatModel(ctx, pickModelCred(in.Cred, in.Req.Model))
	if err != nil {
		return nil, fmt.Errorf("eino: build chat model: %w", err)
	}
	// The compaction config (**what to keep** + how many turns verbatim) lives in
	// agent_compaction.go — the default config would compress 276 messages down to 2 and keep
	// none of the opening facts (F-A-45).
	// The callback fires only when compaction actually triggers (context over threshold); logs
	// one observability line. Short conversations never trigger it — zero noise on normal prod
	// traffic.
	mw, mwerr := summarization.New(ctx, summarizationConfig(cm, contextTokenThreshold,
		func(_ context.Context, before, after adk.ChatModelAgentState) error {
			slog.Default().Info(CompactionLogMsg,
				"before_msgs", len(before.Messages), "after_msgs", len(after.Messages))
			return nil
		}))
	if mwerr != nil {
		return nil, fmt.Errorf("eino: summarization middleware: %w", mwerr)
	}
	agent, aerr := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "visitor",
		Description: "standmeet visitor chat agent",
		Instruction: instructionWithSessionNotes(
			instructionWithDateTime(
				instructionWithCrossConv(
					instructionWithDoc(in.Req.System, in.Req.DocContext), in.CrossConvContext,
				),
				time.Now(), in.OwnerTimezone, in.VisitorTimezone,
			),
			in.SessionNotes,
		),
		Model: cm,
		ToolsConfig: adk.ToolsConfig{
			// guardRepeats: same large-result call dispatches only once per turn (F-D-14).
			ToolsNodeConfig: compose.ToolsNodeConfig{Tools: guardRepeats(ctx, in.Tools)},
			ReturnDirectly:  in.ReturnDirectly,
		},
		MaxIterations: maxAgentIterations,
		Handlers:      []adk.ChatModelAgentMiddleware{mw},
	})
	if aerr != nil {
		return nil, fmt.Errorf("eino: new chat model agent: %w", aerr)
	}
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: true})
	msgs, merr := turnInputMessages(in.Req)
	if merr != nil {
		return nil, merr
	}
	return runner.Run(ctx, msgs), nil
}

// turnInputMessages —— pi history + this turn's user_message → the []*schema.Message fed into
// ADK. Reuses toEinoMessages (no system included — that goes through instruction instead), then
// appends the current user_message.
func turnInputMessages(req *AgentTurnRequest) ([]*schema.Message, error) {
	msgs, err := toEinoMessages("", req.History)
	if err != nil {
		return nil, err
	}
	msgs = append(msgs, schema.UserMessage(req.UserMessage))
	return msgs, nil
}

// DriveAgentLoop —— HTTP-free: consumes the event iterator into the sink, then at the end runs
// H.13 follow-up ghosts + emits Done. The caller (RunAgentTurn / eval-harness) calls
// BuildAgentIterator first to get iter.
func DriveAgentLoop(
	ctx context.Context, log *slog.Logger,
	in *AgentTurnInput, iter *adk.AsyncIterator[*adk.AgentEvent], sink AgentSink,
) {
	em := &loopEmit{log: log, sink: sink, in: in, labels: in.ProgressLabels}
	state := consumeAgentEvents(ctx, em, iter)
	// This boundary runs before the claim gate: a rescued synthesis is still this turn's
	// answer, and the claim gate needs to see it (F-A-40). The path where the stream closed
	// normally but produced nothing used to fall straight through here to Done.
	ensureProduct(ctx, em, state)
	// The claim gate runs BEFORE Done: an answer that says the action happened, in a turn that
	// holds no receipt for it, does not get to end as a normal turn (F-A-37).
	applyClaimGate(log, state, in.ClaimGates)
	logTurnStop(log, state)
	// Done is sent first — lets the visitor's turn wrap up immediately (able to send the next
	// one); #106 billing is background work, never on the critical path.
	sink.Done(doneStop(state))
	// ghost-steering P3: the policy runs **after** done (persist-at-completion: done means
	// committed, and the ledger has already had `visited` updated in onDone); it produces at
	// most one steering ghost from this turn's final reply, sent as a standalone `ghost` frame.
	emitEpilogue(ctx, sink, in, state)
	recordTurnUsage(ctx, in, state)
}

// recordTurnUsage lives in agent_loop_budget.go —— usage and budget are the same concern, and
// it also keeps under the max-lines 350 gate.

// turnState and its handful of small operations live in agent_loop_state.go —— this file also
// keeps under the max-lines 350 gate.

// consumeAgentEvents —— ADK iter → sink. Inspects each AgentEvent's Output (assistant text
// streaming / tool result) / Err and feeds the sink accordingly. Returns the state at the end of
// the turn; Done is the caller's (DriveAgentLoop's) responsibility, so the caller gets a chance
// to add ghosts before done.
func consumeAgentEvents(
	ctx context.Context, em *loopEmit, iter *adk.AsyncIterator[*adk.AgentEvent],
) *turnState {
	state := &turnState{stop: "end_turn"}
	for {
		ev, hasNext := iter.Next()
		if !hasNext {
			return state
		}
		if !routeAgentEvent(ctx, em, ev, state) {
			return state
		}
	}
}

func routeAgentEvent(
	ctx context.Context, em *loopEmit, ev *adk.AgentEvent, state *turnState,
) bool {
	if ev.Err != nil {
		return handleTerminalError(ctx, em, state, ev.Err)
	}
	if ev.Output == nil || ev.Output.MessageOutput == nil {
		return true
	}
	return routeMessageVariant(ctx, em, ev.Output.MessageOutput, state)
}

// routeMessageVariant —— the message carried in an event falls into three kinds:
//   - Role=Assistant + IsStreaming: the model's generated text/tool_call stream, fed into Text
//     chunk by chunk; at stream end, a non-empty ToolCalls feeds a batch of ToolStarted
//   - Role=Assistant + non-streaming: a complete final message, fed as one piece + ToolCalls
//   - Role=Tool: a tool's execution result, fed into ToolCompleted
func routeMessageVariant(
	ctx context.Context, em *loopEmit, mv *adk.MessageVariant, state *turnState,
) bool {
	if mv.Role == schema.Tool {
		emitToolCompleted(em, mv, state)
		return true
	}
	if mv.Role != schema.Assistant {
		return true
	}
	if mv.IsStreaming {
		return drainAssistantStream(ctx, em, mv.MessageStream, state)
	}
	if mv.Message != nil {
		emitAssistantSnapshot(em, mv.Message, state)
	}
	return true
}

func drainAssistantStream(
	ctx context.Context, em *loopEmit,
	stream *schema.StreamReader[*schema.Message], state *turnState,
) bool {
	defer stream.Close()
	accum := newAssistantAccum()
	for {
		if ctx.Err() != nil {
			return false
		}
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			endAssistantRound(em, accum, state)
			return true
		}
		if err != nil {
			// Mid-stream failure takes the SAME boundary as every terminal error: with
			// gathered evidence the visitor still gets a synthesis, not a dropped turn.
			return handleTerminalError(ctx, em, state, err)
		}
		processAssistantChunk(em, chunk, accum, state)
	}
}

func processAssistantChunk(
	em *loopEmit, chunk *schema.Message, accum *assistantAccum, state *turnState,
) {
	if chunk.Content != "" {
		em.sink.Text(chunk.Content)
		state.assistantText += chunk.Content
		state.roundText += chunk.Content
	}
	accumulateAssistantToolCalls(chunk.ToolCalls, accum)
	accumUsage(state, chunk.ResponseMeta)
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.FinishReason != "" {
		state.stop = mapFinishReason(chunk.ResponseMeta.FinishReason)
	}
}

func emitAssistantSnapshot(em *loopEmit, msg *schema.Message, state *turnState) {
	if msg.Content != "" {
		em.sink.Text(msg.Content)
		state.assistantText += msg.Content
		state.roundText += msg.Content
	}
	if len(msg.ToolCalls) > 0 {
		discardRoundText(state)
		accum := newAssistantAccum()
		accumulateAssistantToolCalls(msg.ToolCalls, accum)
		emitToolStarted(em, accum)
	} else {
		commitRoundText(state)
	}
	accumUsage(state, msg.ResponseMeta)
	if msg.ResponseMeta != nil && msg.ResponseMeta.FinishReason != "" {
		state.stop = mapFinishReason(msg.ResponseMeta.FinishReason)
	}
}

// tool_call accumulation during assistant streaming + the end-of-stream emit live in
// agent_loop_tools.go.

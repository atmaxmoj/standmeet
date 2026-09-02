// agent_epilogue.go —— generic turn-epilogue port (#135/#190). After `done`, the loop calls an
// injected EpilogueFunc; if it returns a frame, the loop emits it as an SSE event NAMED by the
// frame's Kind, with the frame's opaque Payload as the data. The kernel doesn't know what "ghost"
// is — Kind + Payload are wiring the route/composition sets. (Ghost steering is one such epilogue:
// the route builds EpilogueFrame{Kind:"ghost", Payload:<json>}; the wire stays `event: ghost`.)
//
// Policy/persistence live in the route/plugin (GhostPolicy LLM + conversation_ghosts); inference
// only calls the injected func and emits the frame. inference touches no DB and no "ghost" concept.

package inference

import (
	"context"
	"encoding/json"
)

// EpilogueFrame —— a single post-`done` frame. Kind = SSE event name (opaque; e.g. "ghost"),
// Payload = opaque JSON the frontend parses per Kind.
type EpilogueFrame struct {
	Kind    string
	Payload json.RawMessage
}

// EpilogueFunc —— injected epilogue port. Called after `done` with the turn's ANSWER (product, not
// the merged stream — planning narration is process and must not steer, F-A-4 P1). Returns a frame
// to emit, or nil for silence.
type EpilogueFunc func(ctx context.Context, lastAssistantMsg string) *EpilogueFrame

// emitEpilogue —— called at the end of DriveAgentLoop: if a frame comes back, emit one SSE
// (event=Kind, data=Payload); a nil return (silence / no epilogue wired) emits nothing.
func emitEpilogue(ctx context.Context, sink AgentSink, in *AgentTurnInput, state *turnState) {
	if in.Epilogue == nil {
		return
	}
	if f := in.Epilogue(ctx, state.product); f != nil {
		sink.Epilogue(f)
	}
}

// usecases.go — the ghost-steering facade. eval-harness only imports agentcore
// (never internal/), so the ghost frame type, policy entry point, and generic-
// epilogue bridge all pass through here. inference no longer knows about
// "ghost": it only emits the generic EpilogueFrame{Kind,Payload}; ghost is one
// kind of epilogue, Kind="ghost", Payload = the GhostFrame below.

package agentcore

import (
	"context"
	"encoding/json"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
)

// GhostFrame is the single ghost-steering suggestion. Its OWN struct now (inference no
// longer knows "ghost"); it is the JSON payload of a Kind="ghost" EpilogueFrame. json tags
// == the `ghost` SSE wire; built/parsed via GhostEpilogue/ParseGhostEpilogue.
type GhostFrame struct {
	Text           string `json:"text"`
	TargetWaypoint string `json:"target_waypoint"`
	FollowsFrom    string `json:"follows_from"`
	GhostID        string `json:"ghost_id"`
	IsBridge       bool   `json:"is_bridge"`
}

// EpilogueFrame re-exports the kernel's generic turn-epilogue frame, so out-of-module
// drivers (eval-harness) can implement inference.EpilogueFunc / AgentSink.Epilogue
// without importing internal.
type EpilogueFrame = inference.EpilogueFrame

// GhostEpilogue wraps a ghost suggestion into the generic epilogue frame (Kind="ghost").
// nil to nil (silence). The one place a ghost becomes a kernel epilogue; kernel stays agnostic.
func GhostEpilogue(g *GhostFrame) *EpilogueFrame {
	if g == nil {
		return nil
	}
	payload, err := json.Marshal(g)
	if err != nil {
		return nil
	}
	return &EpilogueFrame{Kind: "ghost", Payload: payload}
}

// ParseGhostEpilogue extracts the ghost suggestion from a Kind="ghost" epilogue frame (nil if
// the frame is nil, a different kind, or unparseable). The eval sink uses it to capture ghosts.
func ParseGhostEpilogue(f *EpilogueFrame) *GhostFrame {
	if f == nil || f.Kind != "ghost" {
		return nil
	}
	var g GhostFrame
	if err := json.Unmarshal(f.Payload, &g); err != nil {
		return nil
	}
	return &g
}

// Waypoint is an owner-authored steering destination. Out-of-module drivers (eval-harness)
// inject these into BuildGhostPolicy instead of freezing a RoleSnapshot from the DB.
type Waypoint = access.Waypoint

// BuildGhostPolicy is a DB-free ghost policy for out-of-module drivers (eval-harness). It runs
// the same unvisited-gate + policy prompt + parse prod uses (conversation.UnvisitedWaypoints /
// GhostPolicyPrompt / BuildGhostContext / ParseGhost), taking waypoints + visited injected (no
// DB) and persists nothing. nil = silence: empty unvisited, LLM error, or unparseable output.
// Returns the typed GhostFrame; wrap with GhostEpilogue to feed inference.EpilogueFunc.
func BuildGhostPolicy(
	ctx context.Context, cred *Cred, waypoints []Waypoint, visited []string, lastMsg string,
) *GhostFrame {
	unvisited := conversation.UnvisitedWaypoints(waypoints, visited)
	if len(unvisited) == 0 {
		return nil
	}
	out, err := inference.Generate(ctx, cred, &inference.ChatRequest{
		System: conversation.GhostPolicyPrompt,
		Messages: []inference.ChatRequestMsg{
			{Role: "user", Content: conversation.BuildGhostContext(unvisited, lastMsg)},
		},
	})
	if err != nil {
		return nil // silence-on-error (matches prod epilogue)
	}
	cand := conversation.ParseGhost(out)
	if cand == nil {
		return nil
	}
	return &GhostFrame{
		Text: cand.Text, TargetWaypoint: cand.TargetWaypoint,
		FollowsFrom: cand.FollowsFrom, IsBridge: cand.IsBridge,
	}
}

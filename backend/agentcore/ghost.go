// ghost.go —— ghost-steering facade。eval-harness 只 import agentcore(never internal/)，
// 所以 ghost 帧类型 + policy 入口都从这里过一手。

package agentcore

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// GhostFrame is the single ghost-steering suggestion the loop emits after `done`.
// A driver's AgentSink.Ghost(*GhostFrame) receives it (eval captures it for gold).
type GhostFrame = inference.GhostFrame

// Waypoint —— an owner-authored steering destination. Out-of-module drivers (eval-harness)
// inject these into BuildGhostPolicy instead of freezing a RoleSnapshot from the DB.
type Waypoint = domain.Waypoint

// BuildGhostPolicy —— DB-free ghost policy for out-of-module drivers (eval-harness). Runs the
// SAME unvisited-gate + policy prompt + parse prod uses (usecases.UnvisitedWaypoints /
// GhostPolicyPrompt / BuildGhostContext / ParseGhost), but takes waypoints + visited injected
// (no RoleSnapshot DB read) and persists nothing. nil = silence: empty unvisited (no LLM call),
// LLM error, or unparseable. Shaped like inference.BuildGhostFunc — wire straight into BuildGhost.
func BuildGhostPolicy(
	ctx context.Context, cred *Cred, waypoints []Waypoint, visited []string, lastMsg string,
) *GhostFrame {
	unvisited := usecases.UnvisitedWaypoints(waypoints, visited)
	if len(unvisited) == 0 {
		return nil
	}
	out, err := inference.Generate(ctx, cred, &inference.ChatRequest{
		System: usecases.GhostPolicyPrompt,
		Messages: []inference.ChatRequestMsg{
			{Role: "user", Content: usecases.BuildGhostContext(unvisited, lastMsg)},
		},
	})
	if err != nil {
		return nil // silence-on-error (matches prod BuildGhost)
	}
	cand := usecases.ParseGhost(out)
	if cand == nil {
		return nil
	}
	return &GhostFrame{
		Text: cand.Text, TargetWaypoint: cand.TargetWaypoint,
		FollowsFrom: cand.FollowsFrom, IsBridge: cand.IsBridge,
	}
}

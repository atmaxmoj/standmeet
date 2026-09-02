// ghost_policy.go —— ghost-steering P3: policy for a single steering ghost (pure
// prompt + parse + persistence wrapper).
//
// Division of labor: the LLM call (Generate) lives in the route closure (it holds
// creds); this file provides the prompt (versioned, subject to hash-regression
// discipline), parses the LLM output, and persists the policy ghost (route never touches
// postgres, keeping the architecture boundary). Design skeleton in [[ghost-steering]]
// §"The prompt skeleton". "ONE GHOST MESSAGE" is both the skeleton's opening line and the
// marker the mock gateway uses to recognize a GhostPolicy call —— changing this sentence
// requires updating the mock in sync.
//
// ghost is a capability of conversation (not an external plugin): policy/telemetry live
// in core alongside the conversation code. inference only emits a generic
// EpilogueFrame; the route wraps this file's candidate into a Kind="ghost" epilogue.

package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
)

// GhostPolicyPrompt —— the platform-owned, stable, versioned mechanism prompt (part_ids +
// hash discipline). The owner only writes destinations (waypoints), never the mechanism.
// The skeleton's opening line, "ONE GHOST MESSAGE", has a dual role: mock recognition
// marker + the design skeleton's first sentence.
const GhostPolicyPrompt = `You generate at most ONE GHOST MESSAGE: a candidate next message the
VISITOR might send — written in the visitor's voice, not the owner's.

RULES:
1. VOICE — something a curious visitor would plausibly say next: short, first-person,
   their register. Never marketing, never pressure.
2. COHERENCE — it must hook onto something concrete in the assistant's last message
   (name what it follows from).
3. HEADING — tag it with exactly ONE unvisited waypoint it advances. No tag → do not emit.
4. ONE OR NONE — if no natural hook advances any unvisited waypoint, emit NOTHING.
   Silence is an action.
5. SELECTION — follow the visitor's momentum when their own message already
   points at an unvisited waypoint; otherwise the highest-weight waypoint
   coherently reachable in one hop.
6. EVIDENCE — only propose questions the corpus can answer well.
7. NO-REPEAT — a declined waypoint may not be re-offered.
8. TERMINAL — when the goal action is one natural step away, the slot goes to the ask, plainly.

OUTPUT a single JSON object {"text","target_waypoint","follows_from","is_bridge"}
or the literal null.`

// GhostCandidate —— candidate parsed from GhostPolicy's LLM output (nil = silence).
type GhostCandidate struct {
	Text           string `json:"text"`
	TargetWaypoint string `json:"target_waypoint"`
	FollowsFrom    string `json:"follows_from"`
	IsBridge       bool   `json:"is_bridge"`
}

// UnvisitedWaypoints —— the not-yet-visited ones among the frozen waypoints (policy only
// pushes these; all visited → empty → silence).
func UnvisitedWaypoints(waypoints []access.Waypoint, visited []string) []access.Waypoint {
	out := make([]access.Waypoint, 0, len(waypoints))
	for i := range waypoints {
		if !slices.Contains(visited, waypoints[i].WaypointID) {
			out = append(out, waypoints[i])
		}
	}
	return out
}

// SteeringCandidates —— gets this turn's pushable steering waypoints from the frozen
// snapshot: first drops already-visited ones, then (when the snapshot requires evidence)
// removes non-terminal waypoints with no evidence. F-A-10. The switch is read from the
// snapshot (a role value, overridable by code), never threaded across the boundary as a
// flag parameter.
func SteeringCandidates(snap *access.RoleSnapshot, visited []string) []access.Waypoint {
	unvisited := UnvisitedWaypoints(snap.Waypoints(), visited)
	if !snap.RequireGhostEvidence() {
		return unvisited
	}
	return filterSteeringByEvidence(unvisited)
}

// filterSteeringByEvidence —— removes **non-terminal** (steering) waypoints whose
// evidence_refs is empty —— turns prompt rule 6 ("no refs → not proposable") from
// "written but not enforced" into actually enforced. **Terminal/tool waypoints
// (booking) are always kept** —— they're completed via a tool, not the corpus, so they
// have no corpus evidence to begin with.
func filterSteeringByEvidence(waypoints []access.Waypoint) []access.Waypoint {
	out := make([]access.Waypoint, 0, len(waypoints))
	for i := range waypoints {
		if waypoints[i].IsTerminal || len(waypoints[i].EvidenceRefs) > 0 {
			out = append(out, waypoints[i])
		}
	}
	return out
}

// BuildGhostContext —— the user-side context for GhostPolicy: unvisited waypoints
// (id/description/weight/terminal) + this turn's last assistant reply (the COHERENCE
// hook point). The system side is GhostPolicyPrompt.
func BuildGhostContext(unvisited []access.Waypoint, lastMsg string) string {
	lines := make([]string, 0, len(unvisited)+4)
	lines = append(lines, "UNVISITED WAYPOINTS (advance exactly one):")
	for i := range unvisited {
		lines = append(lines, fmt.Sprintf("- id=%s weight=%d terminal=%v: %s",
			unvisited[i].WaypointID, unvisited[i].Weight,
			unvisited[i].IsTerminal, unvisited[i].Description))
	}
	lines = append(lines, "", "THE ASSISTANT'S LAST MESSAGE:", lastMsg)
	return strings.Join(lines, "\n")
}

// ParseGhost —— LLM output (a JSON object or "null") → candidate. Parse failure / null /
// missing text|target → nil.
func ParseGhost(raw string) *GhostCandidate {
	s := strings.TrimSpace(raw)
	if s == "" || s == "null" {
		return nil
	}
	var c GhostCandidate
	if json.Unmarshal([]byte(s), &c) != nil {
		return nil
	}
	if !validGhost(&c) {
		return nil
	}
	return &c
}

// validGhost —— HEADING rule: a policy ghost must have body text + exactly one
// target_waypoint tag.
func validGhost(c *GhostCandidate) bool {
	return c.Text != "" && c.TargetWaypoint != ""
}

// PolicyGhostInput —— input for persisting one policy ghost.
type PolicyGhostInput struct {
	OwnerID        string
	ConversationID string
	Text           string
	TargetWaypoint string
	FollowsFrom    string
}

// RecordPolicyGhost —— persists one policy ghost, returns the row id (the frame filled
// back to the frontend for accept). Via this, route never touches postgres.
func RecordPolicyGhost(ctx context.Context, deps GhostDeps, in *PolicyGhostInput) (string, error) {
	row, err := deps.Repo.RecordPolicy(ctx, &repo.RecordPolicyInput{
		OwnerID: in.OwnerID, ConversationID: in.ConversationID, GhostText: in.Text,
		TargetWaypoint: in.TargetWaypoint, FollowsFrom: in.FollowsFrom,
	})
	if err != nil {
		return "", fmt.Errorf("record policy ghost: %w", err)
	}
	return row.ID, nil
}

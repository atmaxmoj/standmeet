// diag_session.go —— GET /internal/diag/session
//
// Takes X-Session-Token and dumps out the capability map + tool specs + full system
// prompt + hash that the backend assembled for this session. Useful for owner
// troubleshooting and for e2e specs that verify the assembly result (including enabled
// state, quota_remaining computation, etc.); this goes through the same
// AssembleVisitor / ComposeSystemPrompt path as SendMessage, so the hash + body reflect
// the actual outbound prompt.

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// DiagSessionDeps —— deps for /diag/session.
type DiagSessionDeps struct {
	Sessions *access.VisitorSessionStore
	Registry *capreg.Registry
	// Owners —— fetches the owner's name. The persona's first line is "who are you"
	// (UX-66), and this endpoint exists precisely so "the hash reflects the actual
	// outbound prompt" — without this piece, the hash it reports wouldn't match what's
	// actually sent, and a diagnostic that lies is worse than no diagnostic at all.
	Owners owner.OpsHostLookup
	Log    *slog.Logger
}

// MountDiagSession —— /diag/session.
func MountDiagSession(r chi.Router, deps DiagSessionDeps) {
	r.Get("/diag/session", diagSessionHandler(deps))
}

type toolSpecWireV2 struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type diagSessionResp struct {
	SystemPromptHash string                   `json:"system_prompt_hash"`
	SystemPromptFull string                   `json:"system_prompt_full"`
	Capabilities     []capreg.CapabilityState `json:"capabilities"`
	ToolSpecs        []toolSpecWireV2         `json:"tool_specs"`
	// Waypoints —— ghost-steering: the guidance destinations frozen into RoleSnapshot
	// (post-ACL-filter) plus the ledger's visited state. Lets operators/e2e observe the
	// freeze result and waypoint visit status.
	Waypoints []diagWaypoint `json:"waypoints"`
}

// diagWaypoint —— merges a frozen waypoint + ledger visited state for diag output. Field
// order follows fieldalignment.
type diagWaypoint struct {
	WaypointID   string   `json:"waypoint_id"`
	Description  string   `json:"description"`
	EvidenceRefs []string `json:"evidence_refs"`
	Weight       int      `json:"weight"`
	IsTerminal   bool     `json:"is_terminal"`
	Visited      bool     `json:"visited"`
}

func diagSessionHandler(deps DiagSessionDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Session-Token")
		if token == "" {
			http.Error(w, "missing X-Session-Token", http.StatusBadRequest)
			return
		}
		data, err := deps.Sessions.Get(r.Context(), token)
		if err != nil {
			writeSessionLookupErr(w, err)
			return
		}
		writeDiagSession(r.Context(), &deps, w, &data)
	}
}

func writeDiagSession(
	ctx context.Context, deps *DiagSessionDeps,
	w http.ResponseWriter, data *access.VisitorSessionData,
) {
	resp := buildDiagSessionResp(ctx, deps.Registry, data,
		owner.FullNameOf(ctx, deps.Owners, data.OwnerID))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(&resp); eerr != nil {
		deps.Log.Error("diag-session encode", "err", eerr)
	}
}

// buildDiagSessionResp —— pure assembly, no IO; the handler is left with only encode.
// Keeps the handler's own cyclo <= 3 by moving branching into this helper.
// Goes through the same AssembleVisitor / ComposeSystemPrompt path as the real
// SendMessage, so the hash reflects the actual outbound prompt.
// ownerName falls back to an empty string when it can't be fetched: a diagnostic missing
// one piece beats a 500, and `ComposeBasePersona`'s handling of an empty name is
// byte-for-byte identical to its no-identity version.
func buildDiagSessionResp(
	ctx context.Context, reg *capreg.Registry,
	data *access.VisitorSessionData, ownerName string,
) diagSessionResp {
	in := &capreg.AssembleInput{
		RoleSnapshot: data.RoleSnapshot,
		OwnerID:      data.OwnerID,
		Mode:         data.Mode,
		Subject:      capreg.Subject{Kind: capreg.SubjectCode, ID: data.CodeID},
		Visitor:      data.Visitor,
		// ConversationID left empty: the diag endpoint isn't bound to a specific
		// conversation; capability implementations fall back as needed (booker skips
		// the DB lookup with no conv ID).
	}
	basePersona := conversation.ComposeBasePersona(data.RoleSnapshot, ownerName)
	return diagSessionResp{
		Capabilities:     reg.VisitorStates(ctx, in),
		ToolSpecs:        toolSpecsFor(ctx, reg, in),
		SystemPromptHash: reg.SystemPromptHash(ctx, basePersona, in),
		SystemPromptFull: reg.ComposeSystemPrompt(ctx, basePersona, in),
		Waypoints:        diagWaypoints(data.RoleSnapshot.Waypoints(), data.VisitedWaypoints),
	}
}

// diagWaypoints —— attaches ledger visited state to each frozen waypoint
// (waypoint_id ∈ VisitedWaypoints).
func diagWaypoints(frozen []access.Waypoint, visited []string) []diagWaypoint {
	vset := make(map[string]bool, len(visited))
	for _, v := range visited {
		vset[v] = true
	}
	out := make([]diagWaypoint, 0, len(frozen))
	for i := range frozen {
		out = append(out, diagWaypoint{
			WaypointID: frozen[i].WaypointID, Description: frozen[i].Description,
			EvidenceRefs: frozen[i].EvidenceRefs, Weight: frozen[i].Weight,
			IsTerminal: frozen[i].IsTerminal, Visited: vset[frozen[i].WaypointID],
		})
	}
	return out
}

func toolSpecsFor(
	ctx context.Context, reg *capreg.Registry, in *capreg.AssembleInput,
) []toolSpecWireV2 {
	bindings := reg.AssembleVisitor(ctx, in)
	specs := make([]toolSpecWireV2, 0, len(bindings))
	for _, b := range bindings {
		specs = appendBindingToolSpecs(ctx, specs, b)
	}
	return specs
}

// appendBindingToolSpecs —— flattens all of a binding's tool spec names into out,
// and releases the Close hook along the way (introspect closes right after use, so
// the ext-mcp count goes +1 then back to zero).
func appendBindingToolSpecs(
	ctx context.Context, out []toolSpecWireV2, b *capreg.Binding,
) []toolSpecWireV2 {
	for i := range b.Tools {
		out = append(out, toolSpecWireV2{
			Name: b.Tools[i].Name, Description: toolDesc(ctx, &b.Tools[i]),
		})
	}
	if b.Close != nil {
		b.Close()
	}
	return out
}

// toolDesc —— a tool's description (eino Tool.Info().Desc); empty if unavailable.
func toolDesc(ctx context.Context, t *capreg.BindingTool) string {
	if info, err := t.Tool.Info(ctx); err == nil {
		return info.Desc
	}
	return ""
}

func writeSessionLookupErr(w http.ResponseWriter, err error) {
	if errors.Is(err, access.ErrVisitorSessionNotFound) {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	http.Error(w, "internal: "+err.Error(), http.StatusInternalServerError)
}

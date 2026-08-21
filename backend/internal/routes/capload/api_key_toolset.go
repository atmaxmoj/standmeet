// api_key_toolset.go —— assemble an API key's live callable toolset. Kept in the application layer
// (not the pubapi route handlers, which must stay cyclo ≤3): freeze the key's role snapshot,
// assemble its grant through the SAME capreg path the visitor chat uses, then apply the two api
// gates — candidacy (opened) ∩ whitelist (non-Agentic outward tools). So the api surface is exactly
// grant ∩ opened ∩ whitelist − denials, by construction.

package capload

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// apiFacadeMode —— AssembleInput.Mode marker for api-key requests (no conversation, no LLM).
const apiFacadeMode = "api"

// APIToolsetStore —— per-key denials + the owner's opened capabilities (APIKeyRepo implements it).
type APIToolsetStore interface {
	conversation.APIKeyDenialReader
	ListOpenCapabilities(ctx context.Context, ownerID string) ([]string, error)
}

// APIToolsetDeps —— what assembling a key's toolset needs.
type APIToolsetDeps struct {
	Visitor *conversation.VisitorSessionDeps
	Store   APIToolsetStore
	Skills  *capreg.Registry
}

// APIToolset —— the live bindings (caller MUST Close) + the tools the key may call.
type APIToolset struct {
	// Input —— the assembly context this toolset was frozen from. Kept so a handler can ask the
	// registry a follow-up question about the SAME session — "why is that tool not here?" — without
	// rebuilding the snapshot and getting a subtly different answer (F-B-11).
	Input    *capreg.AssembleInput
	Bindings []*capreg.Binding
	Tools    []*capreg.BindingTool
}

// Close —— release every live binding (each capability may hold a socket/plugin handle).
func (t *APIToolset) Close() {
	if t == nil {
		return
	}
	for _, b := range t.Bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}

// AssembleAPIKeyToolset —— freeze snapshot, assemble grant, keep (opened ∩ whitelist) tools.
func AssembleAPIKeyToolset(
	ctx context.Context, deps APIToolsetDeps, key *access.APIKey, whitelist []string,
) (APIToolset, error) {
	snap, err := conversation.BuildAPIKeyRoleSnapshot(ctx, deps.Visitor, deps.Store, key)
	if err != nil {
		return APIToolset{}, fmt.Errorf("build api-key role snapshot: %w", err)
	}
	opened, oerr := deps.Store.ListOpenCapabilities(ctx, key.OwnerID)
	if oerr != nil {
		return APIToolset{}, fmt.Errorf("list open capabilities: %w", oerr)
	}
	in := &capreg.AssembleInput{
		RoleSnapshot: &snap, OwnerID: key.OwnerID,
		Mode: apiFacadeMode,
		// 这条路的主体是这把 key 本身。没有它,能力配额在这个面上没有可数的东西 ——
		// 一把 key 订会一次都不闸(F-B-11)。
		Subject: capreg.Subject{Kind: capreg.SubjectAPIKey, ID: key.ID},
	}
	bindings := deps.Skills.AssembleVisitor(ctx, in)
	tools := filterAPITools(bindings, apiStringSet(opened), apiStringSet(whitelist))
	return APIToolset{Input: in, Bindings: bindings, Tools: tools}, nil
}

// filterAPITools —— tools from opened capabilities whose name is api-renderable.
func filterAPITools(
	bindings []*capreg.Binding, opened, allow map[string]bool,
) []*capreg.BindingTool {
	out := make([]*capreg.BindingTool, 0)
	for _, b := range bindings {
		if opened[b.State.ID] {
			out = appendAllowedTools(out, b, allow)
		}
	}
	return out
}

// appendAllowedTools —— append the binding's whitelisted tools to out.
func appendAllowedTools(
	out []*capreg.BindingTool, b *capreg.Binding, allow map[string]bool,
) []*capreg.BindingTool {
	for i := range b.Tools {
		if allow[b.Tools[i].Name] {
			out = append(out, &b.Tools[i])
		}
	}
	return out
}

func apiStringSet(xs []string) map[string]bool {
	out := make(map[string]bool, len(xs))
	for _, x := range xs {
		out[x] = true
	}
	return out
}

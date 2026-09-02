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

// APIToolsetInput —— one call's assembly context: the key, what may render, and who the caller is
// acting for.
//
// `OnBehalfOf` is the API plane's answer to a question the visitor plane answers with the identity
// picker: an action with a guest (a booking) needs to know whose guest. It is deliberately NOT a
// tool argument — F-B-6 settled that once, when letting the model choose the recipient produced an
// address it had invented from the conversation. Here the caller is a program, and it says who it
// represents in the request itself; the plugin keeps taking the invitee from the session and never
// from its arguments.
type APIToolsetInput struct {
	Key        *access.APIKey
	OnBehalfOf access.VisitorProfile
	Whitelist  []string
}

// AssembleAPIKeyToolset —— freeze snapshot, assemble grant, keep (opened ∩ whitelist) tools.
func AssembleAPIKeyToolset(
	ctx context.Context, deps APIToolsetDeps, in *APIToolsetInput,
) (APIToolset, error) {
	key, whitelist := in.Key, in.Whitelist
	snap, err := conversation.BuildAPIKeyRoleSnapshot(ctx, deps.Visitor, deps.Store, key)
	if err != nil {
		return APIToolset{}, fmt.Errorf("build api-key role snapshot: %w", err)
	}
	opened, oerr := deps.Store.ListOpenCapabilities(ctx, key.OwnerID)
	if oerr != nil {
		return APIToolset{}, fmt.Errorf("list open capabilities: %w", oerr)
	}
	assembleIn := &capreg.AssembleInput{
		RoleSnapshot: &snap, OwnerID: key.OwnerID,
		Mode: apiFacadeMode,
		// The subject on this path is the key itself. Without it, capability quotas have
		// nothing countable on this facet — a key could book meetings without ever being
		// gated (F-B-11).
		Subject: capreg.Subject{Kind: capreg.SubjectAPIKey, ID: key.ID},
		// Who the booking is on behalf of. Empty = unspecified this call, so the capability
		// produces a hold with no guest (and says so plainly in the receipt).
		Visitor: in.OnBehalfOf,
	}
	bindings := deps.Skills.AssembleVisitor(ctx, assembleIn)
	tools := filterAPITools(bindings, apiStringSet(opened), apiStringSet(whitelist))
	return APIToolset{Input: assembleIn, Bindings: bindings, Tools: tools}, nil
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

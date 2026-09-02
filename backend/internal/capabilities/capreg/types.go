// Package capreg —— one Capability interface + Registry, consumed in three
// places: visitor chat tools, the owner MCP server, system prompt fragments.
// See the [[phase-b-capability-registry]] memory for detail.
//
// Phase B-1: the interface skeleton + Registry structure + a global ext-mcp
// counting stub. No concrete capability is registered yet; retrieval / booker /
// ext-mcp / owner-skill / job-loop / MCP parity are filled in, in order, by
// B-2..B-6.
//
// Design constraints:
//   - capreg is a leaf-ish package, depending only on inference + domain + std.
//     Concrete Capability implementations live in the usecases / mcp packages,
//     which import this package to register into it, not the other way around.
//   - A higher-level Capability implementation is closure-shaped: it holds its
//     own deps at construction time, and VisitorBinding only takes per-session
//     context (AssembleInput), never deps — type-safe, no `any`.
package capreg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// ErrHidden —— VisitorBinding returns this sentinel to mean the capability is
// not exposed to this session (a clean path, distinct from a "real error").
// The registry silently skips it; VisitorStates skips it too, leaving it out of
// the capability map.
var ErrHidden = errors.New("capreg: capability hidden from session")

// ErrQuotaExhausted —— **one specific reason** for being hidden: this subject's
// usage has hit its limit.
//
// It **wraps** ErrHidden, so every `errors.Is(err, ErrHidden)` check keeps
// behaving exactly the same (staying hidden on the chat face is still correct:
// don't let the model see a tool it can't use). The only new thing is being able
// to ask why — which is exactly what the HTTP face owed its callers: "your key
// never had this capability" and "your quota ran out" call for different
// actions, and they can't be the same message (F-B-11).
var ErrQuotaExhausted = fmt.Errorf("%w: usage quota exhausted", ErrHidden)

// AssembleInput —— the context for assembling one visitor session. A
// Capability holds its own deps (closure-style) and receives only per-session
// fields.
//
// Same path: the dev endpoint and a real SendMessage go through the same
// AssembleVisitor (a cap implementation must never branch internally on
// whether the caller is test or prod — that would violate the
// [[feedback-always-clean]] same-path principle). When a capability has a
// "shape-only" need (ext-mcp doesn't want to dial just to get its tool name),
// it should cache the shape at register time instead.
//
// ConversationID is empty during dev-endpoint introspection (no conversation
// context); on a real SendMessage it's the conversation the current message
// belongs to.
type AssembleInput struct {
	RoleSnapshot *access.RoleSnapshot
	OwnerID      string
	Mode         string
	// Subject —— **whose identity** this session runs as. Every "N times per
	// subject" rule (capability quota) hangs off this. This field used to hold
	// only `CodeID`, so the external API-key path had no subject to count
	// against — one key could book meetings with zero gating (F-B-11).
	// **The subject is a parameter, not two codepaths** (same principle as
	// capconfig/scope.go).
	Subject        Subject
	Visitor        access.VisitorProfile
	ConversationID string
}

// The BindingTool definition moved to binding_tool.go (H.8: it now goes through
// eino's tool.InvokableTool canonical interface). A Capability can expose
// several tools (e.g. corpus.retrieval exposes search/read/list), sharing one
// CapabilityState (per-capability state is more natural than per-tool).

// Binding —— the instantiation of a visitor-side capability within one session.
//
// nil (VisitorBinding returns nil) means the capability is not exposed to this
// session (e.g. calendar isn't installed, the role's skill doesn't include it).
// When the registry assembles, a nil binding never shows up in the tool spec or
// the capability map at all.
//
// Close is optional; a binding holding an external resource (a long-lived ext
// MCP connection etc.) has it called uniformly by the registry when the session
// ends. No resource → nil.
//
// (The old Cited field was removed: citation has long been self-accumulated by
// inference's accumSink from corpus_read results {id,genre}, decoupled from the
// capability; once retrieval was externalized this field became dead code and
// was deleted along with it.)
type Binding struct {
	Close func()
	// ClaimGate —— the "if it says so, it must do so" condition this capability
	// declares (F-A-37, see claimgate.go). Like ProgressLabel / ReturnDirectly,
	// it's declarative data that rides along with the assembly result; nil means
	// this capability gates no claims.
	ClaimGate *ClaimGate
	Tools     []BindingTool
	State     CapabilityState
}

// CapabilityState —— used by pi-pivot: returned to the frontend zustand store
// when a session is issued. QuotaRemaining / PolicySummary are self-describing,
// so both the LLM and the UI can read them from the same source. Extra is free
// for the capability to use (policy details / connector status and other
// structured data), but must stay serializable.
type CapabilityState struct {
	QuotaRemaining *int32 `json:"quota_remaining,omitempty"`
	ID             string `json:"id"`
	// Title —— a human-readable display name, passed through from the MCP
	// tool's title (used by the #109/#110 dock button label). No fallback: if a
	// capability doesn't implement Titled it's empty, meaning it isn't fit to
	// be a dock button label.
	Title         string          `json:"title,omitempty"`
	PolicySummary string          `json:"policy_summary,omitempty"`
	Extra         json.RawMessage `json:"extra,omitempty"`
	Enabled       bool            `json:"enabled"`
}

// Capability —— the unified registration point for one capability. All three
// consumers read through it.
//
// VisitorBinding returning (nil, ErrHidden) means this session doesn't expose
// this capability (calendar not installed / role's skill doesn't include it /
// ext server unreachable, etc.); distinct from (nil, realErr), a true error.
// When the registry assembles, ErrHidden is silently skipped.
//
// OwnerMCPBindings returns 0+ MCPBinding — one capability can expose several
// owner MCP tools (e.g. seo.bundle exposes seo.set_wiki_slug +
// seo.update_settings); returning an empty slice means this capability exposes
// no owner MCP face.
//
// SystemPromptFragmentID (added at D-2) — if the capability contributes a
// fragment from prompts/ to the current session, returns the fragment id (a
// relative path with no extension, e.g. "capabilities/corpus.retrieval"),
// otherwise returns "". The emptiness test here must stay in sync with
// SystemPromptFragment's "returns non-empty text" test — so the frontend's
// part_ids line up one-to-one with what ComposeSystemPrompt actually splices
// together on the backend.
type Capability interface {
	ID() string
	Shape() Shape
	VisitorBinding(ctx context.Context, in *AssembleInput) (*Binding, error)
	OwnerMCPBindings() []*MCPBinding
	SystemPromptFragment(ctx context.Context, in *AssembleInput) string
	SystemPromptFragmentID(ctx context.Context, in *AssembleInput) string
}

// SessionGate —— an optional per-session exposure predicate for a plugin whose
// tool visibility depends on RUNTIME state the manifest can't express. The
// externalized booker uses it: role-grant alone isn't enough — the owner's
// calendar connector must be connected AND the access code's booking quota not
// exhausted, else the tool stays hidden (chat-book-not-connected /
// chat-book-quota-exhausted). It is wired host-side by the composition root
// (where the connector proxy + store live) and consulted by the mcp-app adapter
// in VisitorBinding, BEFORE dialing the sandbox. Returns (expose, err): false →
// ErrHidden; a real err propagates. nil gate = no extra gating (the default).
type SessionGate func(ctx context.Context, in *AssembleInput) (bool, error)

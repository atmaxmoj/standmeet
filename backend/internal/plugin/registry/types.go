// Package registry —— one Fiber interface + Registry, consumed in three
// places: visitor chat tools, the owner MCP server, system prompt fragments.
//
// A **block** is the atomic unit of code; a **fiber** is one loaded instance of a
// block at runtime (`docs/design/plugin/block-model.md`). This package holds the
// table of fibers and the walks over it.
//
// Design constraints:
//   - registry is a leaf-ish package, depending only on inference + domain + std.
//     Concrete Fiber implementations live in the usecases / mcp packages,
//     which import this package to register into it, not the other way around.
//   - A higher-level Fiber implementation is closure-shaped: it holds its
//     own deps at construction time, and VisitorBinding only takes per-session
//     context (AssembleInput), never deps — type-safe, no `any`.
package registry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// ErrHidden —— VisitorBinding returns this sentinel to mean the block is
// not exposed to this session (a clean path, distinct from a "real error").
// The registry silently skips it; VisitorStates skips it too, leaving it out of
// the block map.
var ErrHidden = errors.New("registry: block hidden from session")

// ErrQuotaExhausted —— **one specific reason** for being hidden: this subject's
// usage has hit its limit.
//
// It **wraps** ErrHidden, so every `errors.Is(err, ErrHidden)` check keeps
// behaving exactly the same (staying hidden on the chat face is still correct:
// don't let the model see a tool it can't use). The only new thing is being able
// to ask why — which is exactly what the HTTP face owed its callers: "your key
// never had this block" and "your quota ran out" call for different
// actions, and they can't be the same message (F-B-11).
var ErrQuotaExhausted = fmt.Errorf("%w: usage quota exhausted", ErrHidden)

// AssembleInput —— the context for assembling one visitor session. A
// Fiber holds its own deps (closure-style) and receives only per-session
// fields.
//
// Same path: the dev endpoint and a real SendMessage go through the same
// AssembleVisitor (a fiber implementation must never branch internally on
// whether the caller is test or prod — that would violate the
// [[feedback-always-clean]] same-path principle). When a block has a
// "shape-only" need (ext-mcp doesn't want to dial just to get its tool name),
// it should cache the shape at register time instead.
//
// ConversationID is empty during dev-endpoint introspection (no conversation
// context); on a real SendMessage it's the conversation the current message
// belongs to.
//
// Field order follows pointer width — enforced by govet fieldalignment.
type AssembleInput struct {
	RoleSnapshot *access.RoleSnapshot
	// bundleMembers / bundleBound / bundleDone —— the code's bundle, resolved once per
	// assembly and cached here (bundle_gate.go). Unexported: this is scratch space for
	// one walk, not something a caller fills in. Read through BundleGrants.
	bundleMembers map[string]bool
	OwnerID       string
	Mode          string
	// Subject —— **whose identity** this session runs as. Every "N times per
	// subject" rule (block quota) hangs off this. This field used to hold
	// only `CodeID`, so the external API-key path had no subject to count
	// against — one key could book meetings with zero gating (F-B-11).
	// **The subject is a parameter, not two codepaths** (same principle as
	// blockconfig/scope.go).
	Subject        Subject
	Visitor        access.VisitorProfile
	ConversationID string
	bundleBound    bool
	bundleDone     bool
}

// The BindingTool definition moved to binding_tool.go (H.8: it now goes through
// eino's tool.InvokableTool canonical interface). A block can expose
// several tools (e.g. corpus.retrieval exposes search/read/list), sharing one
// FiberState (per-block state is more natural than per-tool).

// Binding —— the instantiation of a visitor-side block within one session.
//
// nil (VisitorBinding returns nil) means the block is not exposed to this
// session (e.g. calendar isn't installed, the role's skill doesn't include it).
// When the registry assembles, a nil binding never shows up in the tool spec or
// the block map at all.
//
// Close is optional; a binding holding an external resource (a long-lived ext
// MCP connection etc.) has it called uniformly by the registry when the session
// ends. No resource → nil.
//
// (The old Cited field was removed: citation has long been self-accumulated by
// inference's accumSink from corpus_read results {id,genre}, decoupled from the
// block; once retrieval was externalized this field became dead code and
// was deleted along with it.)
type Binding struct {
	Close func()
	// ClaimGate —— the "if it says so, it must do so" condition this block
	// declares (F-A-37, see claimgate.go). Like ProgressLabel / ReturnDirectly,
	// it's declarative data that rides along with the assembly result; nil means
	// this block gates no claims.
	ClaimGate *ClaimGate
	Tools     []BindingTool
	State     FiberState
}

// FiberState —— used by pi-pivot: returned to the frontend zustand store
// when a session is issued. QuotaRemaining / PolicySummary are self-describing,
// so both the LLM and the UI can read them from the same source. Extra is free
// for the block to use (policy details / supplier status and other
// structured data), but must stay serializable.
type FiberState struct {
	QuotaRemaining *int32 `json:"quota_remaining,omitempty"`
	ID             string `json:"id"`
	// Title —— a human-readable display name, passed through from the MCP
	// tool's title (used by the #109/#110 dock button label). No fallback: if a
	// block doesn't implement Titled it's empty, meaning it isn't fit to
	// be a dock button label.
	Title         string          `json:"title,omitempty"`
	PolicySummary string          `json:"policy_summary,omitempty"`
	Extra         json.RawMessage `json:"extra,omitempty"`
	Enabled       bool            `json:"enabled"`
}

// Fiber —— the unified registration point for one loaded block. All three
// consumers read through it.
//
// VisitorBinding returning (nil, ErrHidden) means this session doesn't expose
// this block (calendar not installed / role's skill doesn't include it /
// ext server unreachable, etc.); distinct from (nil, realErr), a true error.
// When the registry assembles, ErrHidden is silently skipped.
//
// OwnerMCPBindings returns 0+ MCPBinding — one block can expose several
// owner MCP tools (e.g. seo.bundle exposes seo.set_wiki_slug +
// seo.update_settings); returning an empty slice means this block exposes
// no owner MCP face.
//
// SystemPromptFragmentID (added at D-2) — if the block contributes a
// fragment from prompts/ to the current session, returns the fragment id (a
// relative path with no extension, e.g. "blocks/corpus.retrieval"),
// otherwise returns "". The emptiness test here must stay in sync with
// SystemPromptFragment's "returns non-empty text" test — so the frontend's
// part_ids line up one-to-one with what ComposeSystemPrompt actually splices
// together on the backend.
type Fiber interface {
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
// calendar supplier must be connected AND the access code's booking quota not
// exhausted, else the tool stays hidden (chat-book-not-connected /
// chat-book-quota-exhausted). It is wired host-side by the composition root
// (where the supplier proxy + store live) and consulted by the mcp-app adapter
// in VisitorBinding, BEFORE dialing the sandbox. Returns (expose, err): false →
// ErrHidden; a real err propagates. nil gate = no extra gating (the default).
type SessionGate func(ctx context.Context, in *AssembleInput) (bool, error)

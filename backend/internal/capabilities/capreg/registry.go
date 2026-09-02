// registry.go —— the central registration point for Capability. Registration order is
// assembly order (deterministic, the system prompt hash depends on it).
//
// Three walk entry points: List (capability copies, registration order),
// AssembleVisitor (per-session binding sequence, incl. Close), OwnerMCPBindings
// (binding sequence for owner MCP server assembly). AssembleVisitor failures are
// silently skipped; the caller injects logging (log hook added from B-2 on).

package capreg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
)

// EnableGate —— an injected owner-enable resolver: given ownerID, returns the set of
// capability IDs that owner has **turned off** (the owner_enabled gate, P.6). nil = no
// gate installed (eval / unit tests → everything on). The implementation swallows its
// own DB errors (fail-open to everything on, preserving availability).
type EnableGate func(ctx context.Context, ownerID string) map[string]bool

// Registry —— the Capability registration point. Register returns an error on a
// colliding ID; boot-time code should use MustRegister so a startup failure beats
// a silent missing registration at runtime.
type Registry struct {
	seen   map[string]bool
	origin map[string]Origin
	gate   EnableGate
	depReg *DepRegistry
	caps   []Capability
	// alwaysGranted —— capability ids whose manifest says `acl: always` (see SetAlwaysGranted).
	alwaysGranted []string
	mu            sync.RWMutex
}

// NewRegistry —— builds a new empty Registry.
func NewRegistry() *Registry {
	return &Registry{seen: map[string]bool{}, origin: map[string]Origin{}}
}

// Register —— registers a builtin-origin capability. Returns an error on a
// colliding ID / empty ID.
func (r *Registry) Register(c Capability) error {
	return r.RegisterOrigin(c, OriginBuiltin)
}

// RegisterOrigin —— registers with an explicit Origin (plugin-managed / owner-authored).
// Errors on a colliding ID / empty ID; on collision first-wins — the already-registered
// one is never shadowed (the P.5 guard).
func (r *Registry) RegisterOrigin(c Capability, origin Origin) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := c.ID()
	if id == "" {
		return errors.New("capreg: capability with empty ID")
	}
	if r.seen[id] {
		return fmt.Errorf("capreg: duplicate capability ID %q", id)
	}
	r.seen[id] = true
	r.origin[id] = origin
	r.caps = append(r.caps, c)
	return nil
}

// SetEnableGate —— composition root injects the owner-enable resolver (backed by the
// capability_settings repo). Set once at boot; nil-safe (unset → everything on).
func (r *Registry) SetEnableGate(g EnableGate) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gate = g
}

// SetDepRegistry —— composition root injects the named-dependency provider registry
// (D-2). enabledCaps uses it to drop, at the single global gate, any cap whose Requires
// is not connected. Set once at boot; nil-safe (unset → no connector-gating).
func (r *Registry) SetDepRegistry(dr *DepRegistry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.depReg = dr
}

// OriginOf —— the origin of a capability; returns ("", false) if unregistered.
func (r *Registry) OriginOf(id string) (Origin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	o, ok := r.origin[id]
	return o, ok
}

// MustRegister —— panics if Register fails (boot-time; a startup failure beats a
// silent missing registration at runtime).
func (r *Registry) MustRegister(c Capability) {
	if err := r.Register(c); err != nil {
		panic(err)
	}
}

// List —— returns capability copies in registration order (callers can't mutate
// the internal slice).
func (r *Registry) List() []Capability {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Capability, len(r.caps))
	copy(out, r.caps)
	return out
}

// staticFragmentProvider —— an externalized capability implementation: provides
// session-independent prompt text (server initialize instructions) keyed by a stable
// id. GET /api/v1/prompts/{id} falls back here via PromptFragmentText, serving
// fragments that no longer live in the embedded .md files and only exist in a
// plugin's own instructions.
type staticFragmentProvider interface {
	StaticFragmentID() string
	StaticFragment(ctx context.Context) string
}

// PromptFragmentText —— returns a capability's static prompt text by fragment id. A hit
// on an externalized capability returns (text, true); no hit → ("", false). The prompts
// endpoint falls back here when the embedded .md misses, so the frontend can fetch an
// externalized fragment's text by part-id (to splice into the system prompt).
func (r *Registry) PromptFragmentText(ctx context.Context, fragmentID string) (string, bool) {
	for _, c := range r.List() {
		sf, ok := c.(staticFragmentProvider)
		if ok && sf.StaticFragmentID() == fragmentID {
			return sf.StaticFragment(ctx), true
		}
	}
	return "", false
}

// AssembleVisitor —— assembles the set of bindings visible to a given session.
// ErrHidden = the capability actively hides itself (a clean path, silently skipped);
// other errors are also silently skipped (an assembly failure must not block chat);
// only a non-nil binding makes it into the result. Return order matches Register
// order. A capability the owner turned off does not take part in assembly.
func (r *Registry) AssembleVisitor(
	ctx context.Context, in *AssembleInput,
) []*Binding {
	caps := r.enabledCaps(ctx, in)
	out := make([]*Binding, 0, len(caps))
	for _, c := range caps {
		b, err := c.VisitorBinding(ctx, in)
		if err != nil || b == nil {
			continue
		}
		r.dropUnperformableTools(ctx, c, in, b)
		out = append(out, b)
	}
	return out
}

// VisitorStates / visitorStateFor / setCapTitle live in registry_visitor_state.go.

// SetAlwaysGranted —— which capabilities' exposure gate is "unconditional" (manifest
// `acl: always`). Passed in by capload at assembly time (the ACL lives in the
// manifest; the registry itself never parses manifests). Why the registry needs this:
// `VisitorCapabilityIDs` answers "which visitor capabilities did this instance
// register", while **whether it can be docked onto a given role** is different — an
// `acl: role_granted` cap only appears in a session when that role's skill grants it.
// The two used to share one list, so the admin panel accepted a button a visitor
// could never see (F-D-13).
func (r *Registry) SetAlwaysGranted(ids []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.alwaysGranted = slices.Clone(ids)
}

// AlwaysGranted —— the list registered so far (appended to when registration
// happens in several batches).
func (r *Registry) AlwaysGranted() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return slices.Clone(r.alwaysGranted)
}

// DockableCapabilityIDs —— for a role whose skill grants the tools in
// allowedTools, which capabilities its dock can hold: visitor-shaped and (either
// unconditionally exposed, or in this role's granted tools). The test matches
// the session-assembly side (`RoleSnapshot.AllowsCapability`: `aclAlways ||
// allowedTools contains it`).
func (r *Registry) DockableCapabilityIDs(allowedTools []string) []string {
	always := r.AlwaysGranted()
	ids := r.VisitorCapabilityIDs()
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if slices.Contains(always, id) || slices.Contains(allowedTools, id) {
			out = append(out, id)
		}
	}
	return out
}

// VisitorCapabilityIDs —— the set of registered capability ids that aren't
// owner-only (visitor-side capabilities). **It answers "which ones did this
// instance register"**; "which ones can a given role's dock hold" is
// DockableCapabilityIDs's question — the two used to be treated as the same
// thing (F-D-13).
func (r *Registry) VisitorCapabilityIDs() []string {
	caps := r.List()
	out := make([]string, 0, len(caps))
	for i := range caps {
		if caps[i].Shape() != ShapeOwnerOnly {
			out = append(out, caps[i].ID())
		}
	}
	return out
}

// VisitorHeaderFragmentID —— always the first segment of the system prompt
// (visitor-header.md). Exported centrally from Registry so callers don't
// hardcode it everywhere.
const VisitorHeaderFragmentID = "visitor-header"

// VisitorToolSpec —— the tool description the frontend sees (LLM tool API shape).
// Since H.8, assembled from BindingTool.Tool.Info() (eino schema.ToolInfo) +
// BindingTool.InputSchema (raw JSON Schema) + BindingTool.ProgressLabel; the wire
// shape is stable. ProgressLabel (G-8): the text the frontend throbber shows while
// the tool runs ("searching corpus" / "reading entry" / ...); empty → frontend falls
// back to "running <name>". Sourced from the same place as the tool registration,
// removing the frontend's duplicate hardcoded THROBBER_LABELS. omitempty keeps the
// wire clean.
type VisitorToolSpec struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	ProgressLabel string          `json:"progress_label,omitempty"`
	UIHTML        string          `json:"ui_html,omitempty"`
	InputSchema   json.RawMessage `json:"input_schema"`
}

// VisitorToolSpecs —— per-session, runs AssembleVisitor once to get the tool spec
// list (name + description + progress_label + input_schema) of every enabled
// capability, so the frontend pi-agent-core knows which tools to inject into the
// LLM and how to show the throbber. Releases via the Close hook right away (a
// one-shot query).
func (r *Registry) VisitorToolSpecs(
	ctx context.Context, in *AssembleInput,
) []VisitorToolSpec {
	bindings := r.AssembleVisitor(ctx, in)
	out := make([]VisitorToolSpec, 0)
	for _, b := range bindings {
		for i := range b.Tools {
			out = append(out, toolToVisitorSpec(ctx, &b.Tools[i]))
		}
		if b.Close != nil {
			b.Close()
		}
	}
	return out
}

// toolToVisitorSpec —— projects a BindingTool into a VisitorToolSpec. Name reads
// BindingTool.Name directly (the snapshot stashed at NewTool time); Description
// comes from Tool.Info(); InputSchema + ProgressLabel are standmeet's own
// sidecar additions.
func toolToVisitorSpec(ctx context.Context, t *BindingTool) VisitorToolSpec {
	return VisitorToolSpec{
		Name:          t.Name,
		Description:   bindingToolDescription(ctx, t),
		ProgressLabel: t.ProgressLabel,
		InputSchema:   t.InputSchema,
		UIHTML:        t.UIHTML,
	}
}

func bindingToolDescription(ctx context.Context, t *BindingTool) string {
	info, ierr := t.Tool.Info(ctx)
	if ierr != nil || info == nil {
		return ""
	}
	return info.Desc
}

// VisitorPromptPartIDs —— the ordered fragment ids actually spliced into the current
// session's system prompt: [VisitorHeaderFragmentID] + [each capability's non-empty
// fragment id]. The frontend pi-agent-core GETs /api/v1/prompts/{id} in this order
// and splices the text locally, matching the backend ComposeSystemPrompt's splice
// order (registration order = walk order). The "non-empty" test goes through
// capability.SystemPromptFragmentID — the same gating logic as SystemPromptFragment;
// the cap implementation must keep the two in sync. Note: in the base persona,
// role.PromptBody + skillPrompts are DB content with no file id, so this list
// excludes them; the frontend gets those two segments through other fields (shape
// settled at D-4).
func (r *Registry) VisitorPromptPartIDs(
	ctx context.Context, in *AssembleInput,
) []string {
	caps := r.List()
	out := make([]string, 0, 1+len(caps))
	out = append(out, VisitorHeaderFragmentID)
	for _, c := range r.enabledCaps(ctx, in) {
		if id := c.SystemPromptFragmentID(ctx, in); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// OwnerMCPBindings —— walks the registry to get every binding the owner MCP
// server should register. Since B-4, mcp/server.go walks this return value;
// plural lets one capability expose several tools at once (seo / jobs / writings
// and other multi-tool families).
func (r *Registry) OwnerMCPBindings() []*MCPBinding {
	caps := r.List()
	out := make([]*MCPBinding, 0, len(caps))
	for _, c := range caps {
		out = append(out, c.OwnerMCPBindings()...)
	}
	return out
}

// enabledCaps —— List() with the capabilities this owner turned off removed (the
// owner_enabled gate, P.6). Every visitor-facing walk (AssembleVisitor /
// VisitorStates / VisitorPromptPartIDs / ComposeSystemPrompt) goes through it —
// owner-disable becomes a single gate that applies to builtins too.
func (r *Registry) enabledCaps(ctx context.Context, in *AssembleInput) []Capability {
	caps := r.List()
	disabled := r.disabledSet(ctx, in)
	out := make([]Capability, 0, len(caps))
	for _, c := range caps {
		// The single global gate = owner turned it off (disabled) AND every connector
		// in Requires is connected (D-2).
		if disabled[c.ID()] || !r.depsConnected(ctx, c, in) {
			continue
		}
		out = append(out, c)
	}
	return out
}

// disabledSet —— the set of capability IDs this owner has turned off (via the
// injected EnableGate). No gate installed / no owner context → nil (everything on).
func (r *Registry) disabledSet(ctx context.Context, in *AssembleInput) map[string]bool {
	r.mu.RLock()
	gate := r.gate
	r.mu.RUnlock()
	if gate == nil || in == nil || in.OwnerID == "" {
		return map[string]bool{}
	}
	return gate(ctx, in.OwnerID)
}

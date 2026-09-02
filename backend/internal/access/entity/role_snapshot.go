// role_snapshot.go — RoleSnapshot: the Role state frozen at session start.
//
// Design: [[iam-role-pivot-plan]] Session freeze section. At session issue, the Role's
// complete state (corpus URIs / prompt body / skill prompts / allowed tools / skill ids /
// mcp server ids / role id+name+frozen_at) snapshots whole into session_data. The session
// never reads the role row again for its lifetime; owner edits to role/prompt/skill/mcp
// affect only sessions issued afterward. The only remedy is revoke code
// (access_code.status='revoked').
//
// ACL evaluation: positive-list only, raw://** hardcoded deny; everything else goes through
// glob matching, dialect shared with [[path_acl]] (compileGlob lives in path_acl.go).

package entity

import (
	"encoding/json"
	"fmt"
	"slices"
	"time"
)

// RoleSnapshot — the Role state frozen at session start. All fields are immutable;
// constructed only through NewRoleSnapshot, slice containers are defensively cloned.
type RoleSnapshot struct {
	// capConfig —— frozen per-capability, per-role config: capability id -> JSON config.
	// This domain knows none of the keys. Used to be a notifyOwnerOnBooking bool — a
	// business switch grown onto the kernel snapshot, even a roles-table column — while
	// mcpclient's own comment said "the host neither sends nor knows what booking notify
	// is". Name and fact were fighting each other.
	// Frozen because capconfig is live storage the owner can change anytime; a visitor's
	// session must run on the config as it stood at entry — same reasoning as freezing the
	// corpus allowlist and waypoints. (Listed first: fieldalignment, not importance.)
	capConfig      map[string]json.RawMessage
	frozenAt       time.Time
	roleID         string
	roleName       string
	promptBody     string
	codePromptBody string
	// providerID —— the provider the role specified, frozen (empty = owner default). The
	// one on the code overrides it, but that override happens at the session assembly
	// layer — this field only records what the role itself said.
	providerID   string
	corpusURIs   []string
	skillPrompts []string
	allowedTools []string
	// deniedCapabilities —— code-tier ACL: capability ids this code explicitly denies.
	// Orthogonal to allowedTools: exposure gate is baseGrant (ACL=always, or allowedTools
	// contains it) AND NOT denied. Stored separately (not subtracted from allowedTools)
	// since an ACL=always capability (retrieval/ask_visitor) never enters allowedTools —
	// nothing to subtract; it can only be blocked at the gate.
	deniedCapabilities []string
	// deniedCorpusURIs —— corpus tier of the three-tier ACL: globs this code takes back
	// from the role's positive list. Orthogonal to corpusURIs (not removed from it): glob
	// subtraction can't remove a list entry (`subjectivity://cv` can't subtract from
	// `subjectivity://**`); checked at match time. AllowsCorpus: matches a grant AND no deny.
	deniedCorpusURIs []string
	skillIDs         []string
	mcpServerIDs     []string
	// dockButtons —— #109/#110 the role's <=2 chat dock button configs, as configured by
	// the owner (frozen).
	dockButtons []DockButtonConfig
	// waypoints —— ghost-steering guidance destinations (frozen). FilterWaypointsByCorpus
	// drops any waypoint whose evidence_refs are all outside the authorized glob (the floor).
	waypoints []Waypoint
	// requireGhostEvidence —— F-A-10: frozen "content-steering ghost needs evidence" switch
	// (role's value, overridable by a code). Ghost selection excludes a non-terminal
	// waypoint with no evidence from candidates; terminal/tool waypoints unaffected.
	requireGhostEvidence bool
	// gasMetered —— whether the role carries a gas meter, frozen.
	gasMetered bool
}

// RoleSnapshotInit —— input for NewRoleSnapshot.
type RoleSnapshotInit struct {
	// CapConfig —— each capability's config on this role (capability id -> JSON object).
	// Read once from capconfig's role scope at the moment of freezing. This domain does
	// not interpret any of the keys inside.
	CapConfig      map[string]json.RawMessage
	FrozenAt       time.Time
	RoleID         string
	RoleName       string
	PromptBody     string
	CodePromptBody string
	// ProviderID —— the provider the role specifies (empty = owner default), frozen as-is.
	ProviderID           string
	CorpusURIs           []string
	SkillPrompts         []string
	AllowedTools         []string
	DeniedCapabilities   []string
	DeniedCorpusURIs     []string
	SkillIDs             []string
	MCPServerIDs         []string
	DockButtons          []DockButtonConfig
	Waypoints            []Waypoint
	RequireGhostEvidence bool
	// GasMetered —— whether the role carries a gas meter, frozen as-is.
	GasMetered bool
}

// NewRoleSnapshot —— construct from Init. Slice fields are defensively cloned; empty input
// -> empty slice.
func NewRoleSnapshot(i *RoleSnapshotInit) RoleSnapshot {
	return RoleSnapshot{
		frozenAt:             i.FrozenAt,
		roleID:               i.RoleID,
		roleName:             i.RoleName,
		promptBody:           i.PromptBody,
		codePromptBody:       i.CodePromptBody,
		corpusURIs:           cloneStrings(i.CorpusURIs),
		skillPrompts:         cloneStrings(i.SkillPrompts),
		allowedTools:         cloneStrings(i.AllowedTools),
		deniedCapabilities:   cloneStrings(i.DeniedCapabilities),
		deniedCorpusURIs:     cloneStrings(i.DeniedCorpusURIs),
		skillIDs:             cloneStrings(i.SkillIDs),
		mcpServerIDs:         cloneStrings(i.MCPServerIDs),
		dockButtons:          cloneDockButtons(i.DockButtons),
		waypoints:            cloneWaypoints(i.Waypoints),
		requireGhostEvidence: i.RequireGhostEvidence,
		providerID:           i.ProviderID,
		gasMetered:           i.GasMetered,
		capConfig:            cloneCapConfig(i.CapConfig),
	}
}

// cloneCapConfig —— defensive copy. nil -> an empty map: "this role has no capability
// config" and "the config went missing" must be the same safe answer, not a nil that can
// crash the caller.
func cloneCapConfig(in map[string]json.RawMessage) map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(in))
	for k, v := range in {
		out[k] = slices.Clone(v)
	}
	return out
}

// RequireGhostEvidence —— F-A-10: the frozen switch. Ghost selection uses it to filter out
// a non-terminal waypoint with no evidence.
func (s *RoleSnapshot) RequireGhostEvidence() bool { return s.requireGhostEvidence }

// ProviderID —— the frozen role provider (empty = owner's default).
func (s *RoleSnapshot) ProviderID() string { return s.providerID }

// GasMetered —— the frozen gas-meter switch.
func (s *RoleSnapshot) GasMetered() bool { return s.gasMetered }

// CapConfig —— the frozen per-capability, per-role config (defensive copy). The assembly
// layer hands each capability its slice via the tool-call's `_meta`; the sandboxed plugin
// reads its own share. This domain does not interpret any of the keys.
func (s *RoleSnapshot) CapConfig() map[string]json.RawMessage {
	return cloneCapConfig(s.capConfig)
}

// Waypoints —— the frozen guidance destinations (defensive copy, evidence_refs cloned too).
func (s *RoleSnapshot) Waypoints() []Waypoint { return cloneWaypoints(s.waypoints) }

// FrozenAt —— the moment of session issue; used by the admin /admin/codes card's
// "issued with role @ ... (frozen)" display.
func (s *RoleSnapshot) FrozenAt() time.Time { return s.frozenAt }

// RoleID —— the snapshotted role id (admin can still jump to it after the owner renames
// the role).
func (s *RoleSnapshot) RoleID() string { return s.roleID }

// RoleName —— the role's name at the moment of the snapshot (for display).
func (s *RoleSnapshot) RoleName() string { return s.roleName }

// PromptBody —— the snapshotted prompt.body in full, 0..1 (the public body when this is
// public; "" for a role with no prompt attached). visitor_chat.buildSystemPrompt assembles
// it in.
func (s *RoleSnapshot) PromptBody() string { return s.promptBody }

// CodePromptBody —— the prompt text this access code carries of its own, 0..1 (#104). The
// session persona **layers** it on after the role persona; empty when none is attached
// (persona stays byte-identical, guarded by the prompt-hash regression).
func (s *RoleSnapshot) CodePromptBody() string { return s.codePromptBody }

// DockButtons —— the frozen <=2 dock button configs (defensive copy). The session assembly
// layer resolves titles + filters code-deny from this before it goes out in the session
// payload.
func (s *RoleSnapshot) DockButtons() []DockButtonConfig { return cloneDockButtons(s.dockButtons) }

// CorpusURIs —— the snapshotted URI glob allowlist (defensive copy).
func (s *RoleSnapshot) CorpusURIs() []string { return slices.Clone(s.corpusURIs) }

// SkillPrompts —— all snapshotted skill.prompt values, for assembling the system prompt
// (defensive copy).
func (s *RoleSnapshot) SkillPrompts() []string { return slices.Clone(s.skillPrompts) }

// AllowedTools —— the snapshotted skill.allowed_tools, merged and deduplicated (defensive
// copy).
func (s *RoleSnapshot) AllowedTools() []string { return slices.Clone(s.allowedTools) }

// DeniedCapabilities —— capability ids the code tier explicitly denies (defensive copy).
// The capability-exposure gate uses it to block a capability that passed baseGrant
// (including an ACL=always one).
func (s *RoleSnapshot) DeniedCapabilities() []string { return slices.Clone(s.deniedCapabilities) }

// AllowsCapability —— capability-exposure verdict for the frozen part of the three-tier ACL
// (the live gate is computed elsewhere): baseGrant (aclAlways, or allowedTools contains it)
// AND not code-denied. Truth anchor for the three-tier ACL (capability-acl-hierarchy.md §3):
// a code can only subtract; even ACL=always can be denied (never in allowedTools, so only
// stoppable at the gate).
func (s *RoleSnapshot) AllowsCapability(capID string, aclAlways bool) bool {
	if slices.Contains(s.deniedCapabilities, capID) {
		return false
	}
	return aclAlways || slices.Contains(s.allowedTools, capID)
}

// SkillIDs —— the snapshotted skill id list, used for capability gating at agent invoke time.
func (s *RoleSnapshot) SkillIDs() []string { return slices.Clone(s.skillIDs) }

// MCPServerIDs —— the snapshotted MCP server id list, used for mcp client wiring.
func (s *RoleSnapshot) MCPServerIDs() []string { return slices.Clone(s.mcpServerIDs) }

// IsZero —— whether the session has no RoleSnapshot attached (used on the fallback path).
func (s *RoleSnapshot) IsZero() bool {
	return s.roleID == "" && len(s.corpusURIs) == 0
}

// AllowsCorpus —— evaluates admission for one note. raw://** hardcoded deny; an invited
// identity goes through positive-list glob matching (empty corpus_uris = deny everything),
// the public identity looks at whether this note itself is published.
//
// Both the pattern and the entry URI include the scheme ("wiki://thinking/lucerna");
// compileGlob turns "wiki://thinking/**" into the "^wiki://thinking/.*$" regex and matches
// the URI directly.
func (s *RoleSnapshot) AllowsCorpus(uri string, published bool) bool {
	return AllowsCorpusEntry(s.CorpusScope(), CorpusEntryRef{URI: uri, Published: published})
}

// CorpusScope —— frozen corpus admission range (role's granted positive list + what this
// code takes back). The public identity carries no positive list: its range is decided by
// each note's own `published` field (PublishedOnly). Verdict comes from the role name
// frozen into the snapshot — the builtin public role can't be renamed and is unique within
// an owner, so this check is reliable, and the name is already in the Redis wire form.
func (s *RoleSnapshot) CorpusScope() CorpusScope {
	return CorpusScope{
		Granted:       s.CorpusURIs(),
		Denied:        s.DeniedCorpusURIs(),
		PublishedOnly: ReadsPublishedSlice(s.roleName),
	}
}

// DeniedCorpusURIs —— the globs the code tier takes back (defensive copy).
func (s *RoleSnapshot) DeniedCorpusURIs() []string { return slices.Clone(s.deniedCorpusURIs) }

// MarshalJSON / UnmarshalJSON —— sessions are stored in Redis as JSON; the encapsulated
// type is not serializable by default, so a sidecar wire form maps the fields out.
func (s *RoleSnapshot) MarshalJSON() ([]byte, error) {
	b, err := json.Marshal(roleSnapshotWire{
		FrozenAt:             s.frozenAt,
		RoleID:               s.roleID,
		RoleName:             s.roleName,
		PromptBody:           s.promptBody,
		CodePromptBody:       s.codePromptBody,
		CorpusURIs:           s.corpusURIs,
		SkillPrompts:         s.skillPrompts,
		AllowedTools:         s.allowedTools,
		DeniedCapabilities:   s.deniedCapabilities,
		DeniedCorpusURIs:     s.deniedCorpusURIs,
		SkillIDs:             s.skillIDs,
		MCPServerIDs:         s.mcpServerIDs,
		DockButtons:          s.dockButtons,
		Waypoints:            s.waypoints,
		RequireGhostEvidence: s.requireGhostEvidence,
		CapConfig:            s.capConfig,
		ProviderID:           s.providerID,
		GasMetered:           s.gasMetered,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal role snapshot: %w", err)
	}
	return b, nil
}

// UnmarshalJSON —— deserialization goes through NewRoleSnapshot's defensive-clone path.
func (s *RoleSnapshot) UnmarshalJSON(data []byte) error {
	var w roleSnapshotWire
	if err := json.Unmarshal(data, &w); err != nil {
		return fmt.Errorf("unmarshal role snapshot: %w", err)
	}
	*s = NewRoleSnapshot(&RoleSnapshotInit{
		FrozenAt:             w.FrozenAt,
		RoleID:               w.RoleID,
		RoleName:             w.RoleName,
		PromptBody:           w.PromptBody,
		CodePromptBody:       w.CodePromptBody,
		CorpusURIs:           w.CorpusURIs,
		SkillPrompts:         w.SkillPrompts,
		AllowedTools:         w.AllowedTools,
		DeniedCapabilities:   w.DeniedCapabilities,
		DeniedCorpusURIs:     w.DeniedCorpusURIs,
		SkillIDs:             w.SkillIDs,
		MCPServerIDs:         w.MCPServerIDs,
		DockButtons:          w.DockButtons,
		Waypoints:            w.Waypoints,
		RequireGhostEvidence: w.RequireGhostEvidence,
		CapConfig:            w.CapConfig,
		ProviderID:           w.ProviderID,
		GasMetered:           w.GasMetered,
	})
	return nil
}

// roleSnapshotWire —— the JSON sidecar. Field order follows fieldalignment: time first
// (time.Time = 24B with monotonic clock), string in the middle, slice last.
type roleSnapshotWire struct {
	// CapConfig —— frozen per-capability, per-role config. Must survive the round trip:
	// miss it and a capability gets an empty config after one JSON round trip — "empty"
	// looks identical to "never turned on", so an enabled switch would silently turn off.
	CapConfig      map[string]json.RawMessage `json:"capability_config,omitempty"`
	FrozenAt       time.Time                  `json:"frozen_at"`
	RoleID         string                     `json:"role_id"`
	RoleName       string                     `json:"role_name"`
	PromptBody     string                     `json:"prompt_body,omitempty"`
	CodePromptBody string                     `json:"code_prompt_body,omitempty"`
	// ProviderID —— the frozen role provider (empty = owner default).
	ProviderID         string             `json:"provider_id,omitempty"`
	CorpusURIs         []string           `json:"corpus_uris,omitempty"`
	SkillPrompts       []string           `json:"skill_prompts,omitempty"`
	AllowedTools       []string           `json:"allowed_tools,omitempty"`
	DeniedCapabilities []string           `json:"denied_capabilities,omitempty"`
	DeniedCorpusURIs   []string           `json:"denied_corpus_uris,omitempty"`
	SkillIDs           []string           `json:"skill_ids,omitempty"`
	MCPServerIDs       []string           `json:"mcp_server_ids,omitempty"`
	DockButtons        []DockButtonConfig `json:"dock_buttons,omitempty"`
	Waypoints          []Waypoint         `json:"waypoints,omitempty"`
	// Boolean role config must survive the round trip too: the wire form used to miss them,
	// so a snapshot silently reverted to false after one JSON round trip — looked frozen but
	// was lost (F-A-10's require_ghost_evidence hit this exact bug).
	RequireGhostEvidence bool `json:"require_ghost_evidence,omitempty"`
	GasMetered           bool `json:"gas_metered,omitempty"`
}

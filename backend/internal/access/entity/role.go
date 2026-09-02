// role.go — the owner-scoped visitor identity archetype. Design: [[iam-role-pivot-plan]].
//
// Role = persona (Prompt) + visible corpus URI globs + Skills + MCP servers. An access_code
// carries one assumed_role_id; at session start the role is snapshotted whole into
// session_data (RoleSnapshot), decoupling it from the live role — the owner editing a role
// does not affect a running session, the only remedy is revoke code.
//
// The public role (is_builtin=true) is seeded by SeedPublicRole when the owner claims the
// instance: three public-corpus globs, no skill, no mcp, the public prompt attached.
// Cannot be deleted (blocked at the repo layer).
//
// LSP / OCP note: Role itself is a value object, no sub-type. Corpus ACL evaluation goes
// through one method, AllowsCorpus(uri) — positive-list only, no deny / no ordering; the
// one hardcode is raw://** always denying visitors.

package entity

import (
	"errors"
	"slices"
	"strings"
	"time"
)

// Role — the domain value object for a roles row + its associated corpus URIs / skill IDs /
// mcp server IDs.
type Role struct {
	createdAt   time.Time
	updatedAt   time.Time
	id          string
	ownerID     string
	name        string
	description string
	greeting    string // the "what is this" intro on the visitor name picker (empty = default)
	promptID    string // empty = no prompt attached (public has one too; the true-NULL case)
	// providerID —— which provider in the owner's ledger this role uses. Empty = use the
	// default one. The one carried on the code overrides it (the code is the ticket that
	// went out, so it's more specific).
	providerID   string
	corpusURIs   []string
	skillIDs     []string
	mcpServerIDs []string
	// waypoints —— ghost-steering guidance destinations (written by the owner, per-role).
	// Frozen into RoleSnapshot at session freeze + filtered by corpus glob (see
	// FilterWaypointsByCorpus).
	waypoints []Waypoint
	// dockButtons —— #109/#110 this role's <=2 chat dock button configs.
	dockButtons []DockButtonConfig
	isBuiltin   bool
	hasPrompt   bool
	// requireGhostEvidence —— F-A-10: when on, a "content-steering ghost" only offers a
	// waypoint that has evidence_refs (a non-terminal waypoint with no evidence is not
	// offered as a steering ghost); terminal/tool waypoints are unaffected. A code may
	// override it.
	requireGhostEvidence bool
	// gasMetered —— whether this role carries a gas meter. false (default) = zero gas
	// queries fired, identical to today's path.
	gasMetered bool
}

// RoleInit —— constructor arguments.
type RoleInit struct {
	CreatedAt   time.Time
	UpdatedAt   time.Time
	PromptID    *string
	ID          string
	OwnerID     string
	Name        string
	Description string
	Greeting    string
	// ProviderID —— which provider this role uses (empty = owner default).
	ProviderID   string
	CorpusURIs   []string
	SkillIDs     []string
	MCPServerIDs []string
	Waypoints    []Waypoint
	DockButtons  []DockButtonConfig
	IsBuiltin    bool
	// This used to hold NotifyOwnerOnBooking — a per-role **business** switch that had
	// grown onto the kernel entity, all the way to a column on the roles table. It is now
	// role_config that calendar.book declares in its own manifest, stored in capconfig's
	// role scope; the access domain no longer even knows its name.
	//
	// RequireGhostEvidence stays — it governs whether ghost guidance needs evidence, and
	// that is this domain's own rule, not owned by any one capability.
	// RequireGhostEvidence —— F-A-10 per-role switch.
	RequireGhostEvidence bool
	// GasMetered —— whether this role carries a gas meter.
	GasMetered bool
}

// NewRole —— construct from Init. Container fields are defensively cloned; nil -> empty slice.
func NewRole(i *RoleInit) Role {
	r := Role{
		id:                   i.ID,
		ownerID:              i.OwnerID,
		name:                 i.Name,
		description:          i.Description,
		greeting:             i.Greeting,
		isBuiltin:            i.IsBuiltin,
		createdAt:            i.CreatedAt,
		updatedAt:            i.UpdatedAt,
		corpusURIs:           cloneStrings(i.CorpusURIs),
		skillIDs:             cloneStrings(i.SkillIDs),
		mcpServerIDs:         cloneStrings(i.MCPServerIDs),
		waypoints:            cloneWaypoints(i.Waypoints),
		dockButtons:          cloneDockButtons(i.DockButtons),
		requireGhostEvidence: i.RequireGhostEvidence,
		providerID:           i.ProviderID,
		gasMetered:           i.GasMetered,
	}
	if i.PromptID != nil {
		r.promptID = *i.PromptID
		r.hasPrompt = true
	}
	return r
}

func cloneStrings(s []string) []string {
	if len(s) == 0 {
		return []string{}
	}
	return slices.Clone(s)
}

// ID —— DB primary key.
func (r *Role) ID() string { return r.id }

// OwnerID —— owner-scoped FK.
func (r *Role) OwnerID() string { return r.ownerID }

// Name —— role slug (unique within an owner).
func (r *Role) Name() string { return r.name }

// Description —— a one-line summary (admin-internal use).
func (r *Role) Description() string { return r.description }

// Greeting —— the "what is this" intro shown on the visitor name picker (per-role,
// owner-editable).
func (r *Role) Greeting() string { return r.greeting }

// PromptID —— the attached prompt's ID, plus a second return for whether one is set.
// SET NULL on prompt delete sets hasPrompt = false.
func (r *Role) PromptID() (string, bool) {
	if !r.hasPrompt {
		return "", false
	}
	return r.promptID, true
}

// HasPrompt —— whether a prompt is attached.
func (r *Role) HasPrompt() bool { return r.hasPrompt }

// CorpusURIs —— the visible corpus URI glob list (defensive copy).
func (r *Role) CorpusURIs() []string { return slices.Clone(r.corpusURIs) }

// SkillIDs —— the unlocked skill id list (defensive copy).
func (r *Role) SkillIDs() []string { return slices.Clone(r.skillIDs) }

// MCPServerIDs —— the unlocked MCP server id list (defensive copy).
func (r *Role) MCPServerIDs() []string { return slices.Clone(r.mcpServerIDs) }

// DockButtons —— this role's <=2 chat dock button configs (defensive copy).
func (r *Role) DockButtons() []DockButtonConfig { return cloneDockButtons(r.dockButtons) }

// Waypoints —— ghost-steering guidance destinations (defensive copy). Filtered through
// FilterWaypointsByCorpus before entering RoleSnapshot at freeze time.
func (r *Role) Waypoints() []Waypoint { return cloneWaypoints(r.waypoints) }

// IsBuiltin —— whether this was seeded as a builtin (public is true).
func (r *Role) IsBuiltin() bool { return r.isBuiltin }

// RequireGhostEvidence —— F-A-10: whether a content-steering ghost requires corpus evidence
// (a non-terminal waypoint with no evidence is not offered as a steering ghost). Per-role,
// may be overridden by a code at session freeze.
func (r *Role) RequireGhostEvidence() bool { return r.requireGhostEvidence }

// ProviderID —— the provider this role specifies (empty = owner's default).
func (r *Role) ProviderID() string { return r.providerID }

// GasMetered —— whether this role carries a gas meter.
func (r *Role) GasMetered() bool { return r.gasMetered }

// CreatedAt —— creation time.
func (r *Role) CreatedAt() time.Time { return r.createdAt }

// UpdatedAt —— last-updated time.
func (r *Role) UpdatedAt() time.Time { return r.updatedAt }

// HasSkill —— whether the role has a given skill attached.
func (r *Role) HasSkill(skillID string) bool {
	return slices.Contains(r.skillIDs, skillID)
}

// HasMCPServer —— whether the role has a given MCP server attached.
func (r *Role) HasMCPServer(mcpServerID string) bool {
	return slices.Contains(r.mcpServerIDs, mcpServerID)
}

// AllowsCorpus —— evaluates URI admission. raw://** is a hardcoded deny; everything else
// goes through positive-list glob matching. Empty corpus_uris = deny everything.
//
// Same semantics as [[role_snapshot]].AllowsCorpus; the snapshot is the copy frozen at
// session start, this method is the owner-facing live check (used for admin debugging).
// Same glob engine ([[path_acl]]'s compileGlob).
func (r *Role) AllowsCorpus(uri string) bool {
	if strings.HasPrefix(uri, "raw://") {
		return false
	}
	for _, pattern := range r.corpusURIs {
		if compileGlob(pattern).MatchString(uri) {
			return true
		}
	}
	return false
}

// PublicRoleName —— the builtin public role's name (used to be called "vanilla" — too
// arbitrary a name, not self-explanatory — renamed to "public"). Used by SeedPublicRole.
//
// Why "public": every access code is a **directed invite**, freezing an owner-specified
// role. A BYOAI visitor (brings their own API key, never invited, the default path via
// /gate) belongs to no invite → falls to this **default, public** role. So "an uninvited
// default visitor = public". Locked in by the public/byoai path in visitor_public.go.
// It is is_builtin=true: cannot be deleted, name cannot be changed, but the owner **can
// change its prompt**.
//
// **jobsuc's auto-issued application code no longer carries it** — that code is printed in
// the QR in the top-right corner of a resume, and is a **directed invite** (the sentence
// right above this one defines code exactly that way). Letting an invite fall onto "the
// fallback for the uninvited" became, once public narrowed to "reads only what's
// published": a recruiter scanning the code only sees the public page. See InvitedRoleName.
//
// **Its corpus scope is not an editable list**: what public reads is exactly what the owner
// has published, decided entry-by-entry by each note's own `published` switch. This
// comment used to read "the visitor-identity role's name and content visibility are two
// separate things, different tables, different columns, not the same entity" — that
// sentence described the database, and I read it as a product promise to visitors, so
// "a stranger reading a private note" looked like a naming collision instead of a privilege
// escalation (F-D-7). Now the two are the same data: **private with no code stays unreadable**.
const PublicRoleName = "public"

// ReadsPublishedSlice —— whether this identity's corpus scope is "what the owner has
// published".
//
// One function, because three places need to ask the same question: session admission
// (RoleSnapshot only has the name), the role card, and the code card's line about "what
// this code inherits". Written separately, some surface would eventually infer it from
// "is the positive list empty", and that inference gives exactly the wrong answer for
// public — the code card once rendered `(role grants nothing)` because of it.
func ReadsPublishedSlice(roleName string) bool {
	return roleName == PublicRoleName
}

// PublicRoleDescription —— a one-line summary of the public role.
const PublicRoleDescription = "System default. Reads exactly what you have published — " +
	"each entry's own switch decides. No skills, no MCP. For uninvited BYOAI visitors " +
	"(access codes are directed invites; this is the fallback)."

// PublicRoleCorpusURIs —— the public identity carries **no positive list**: what it reads
// is exactly what the owner has published, decided by each note's own `published` switch
// (`CorpusScope.PublishedOnly`).
//
// This used to be `{wiki://**, output://**, writing://**}` — a **second copy of the same
// data**, restating "who can read what" as globs. So an entry marked PRIVATE and this list
// saying "everything" knew nothing of each other: under F-D-7, a stranger with no code
// read 573 notes marked PRIVATE in wiki, while those three checkmarks on /admin/roles still
// glowed "all of it" — looking like a decision the owner made, when he never chose it; it
// was seeded in at claim time.
//
// Kept as an empty slice rather than deleting the name: the seed still explicitly writes
// once that "public has no positive list", so "never set" and "set to empty" stay the same
// written fact in the code.
var PublicRoleCorpusURIs = []string{}

// InvitedRoleName —— the builtin `invited` role: codes **the product itself issues**
// carry it.
//
// This name draws exactly the line drawn in the comment above PublicRoleName: `public` =
// the uninvited fallback, `invited` = a directed invite. The product issues codes on the
// owner's behalf in two places — the one job loop prints in a resume QR, and the one issued
// when the owner approves a gate request — both are invites, so both carry this role.
// Named `invited` rather than `applicant`: hiring is only one channel, and what's being
// scoped is "invited or not".
//
// It inherits exactly the three globs public carried before F-D-7: this change **did not
// touch what an invited visitor sees**, it only pulled "uninvited" out of that scope. If
// the owner wants to narrow it, they edit this one on /admin/roles — that is a genuine
// positive list, and editing it is a decision.
const InvitedRoleName = "invited"

// InvitedRoleDescription —— a one-line summary of the invited role.
const InvitedRoleDescription = "System default for the codes StandMeet issues for you — the QR " +
	"on a résumé, or the code that goes out when you approve a request. A directed invite: it " +
	"reads your curated corpus, published or not. Narrow it here if invitees should see less."

// InvitedRoleCorpusURIs —— the surface an invited visitor can read (= public's three
// pre-F-D-7 entries).
var InvitedRoleCorpusURIs = []string{
	"wiki://**",
	"output://**",
	"writing://**",
}

// A `HiringRole*` used to live here — the one job loop needed. It does not belong in the
// kernel: `hiring` is that plugin's concept, not a kernel-level access tier, and the glob
// it carries (where a recruiter's CV read is) only the plugin can define. It now lives in
// `internal/owner/jobs/jobs_seed.go`, seeded through capabilities.OwnerSeeder. Note that
// `check-core-agnostic`'s CORE_DIRS **does not cover this package**, so that leak stayed
// green under lint.

// ErrRoleNotFound —— the role id does not exist or does not belong to this owner.
var ErrRoleNotFound = errors.New("role not found")

// ErrRoleNameTaken —— name is duplicated within the same owner (unique constraint).
var ErrRoleNameTaken = errors.New("role name already taken in this owner")

// ErrRoleBuiltinImmutable —— an attempt to delete or rename a builtin role (public).
var ErrRoleBuiltinImmutable = errors.New("builtin role cannot be deleted or renamed")

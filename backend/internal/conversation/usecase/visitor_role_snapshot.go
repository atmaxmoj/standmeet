// visitor_role_snapshot.go —— at session issuance, snapshots the Role state into
// session_data. Design in [[iam-role-pivot-plan]] · Session freeze section. Since
// A.3-IAM-5, access_code must carry assumed_role_id (NOT NULL); public / byoai use the
// owner's public role instead. Assembled from role + prompt + skills; nothing is read
// back for the rest of the session's lifetime.

package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// buildRoleSnapshotForCode —— code.AssumedRoleID is required (schema NOT NULL) → builds
// the RoleSnapshot. A failure here is always a real error.
func buildRoleSnapshotForCode(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
) (access.RoleSnapshot, error) {
	denials, err := loadCodeDenials(ctx, deps, code.ID)
	if err != nil {
		return access.RoleSnapshot{}, err
	}
	// #104 (+extension): the code's own prompt freezes into the snapshot, layered after
	// the role persona. prompt_id (owner's centrally-managed) comes first, inline (the
	// issuer's sentence) comes after —— the two layers **stack**.
	codePrompt, perr := resolveCodePrompt(ctx, deps, code)
	if perr != nil {
		return access.RoleSnapshot{}, perr
	}
	// ghost-steering: this code's waypoint overlay (empty = fully inherits the role's).
	wps, werr := loadCodeWaypoints(ctx, deps, code.ID)
	if werr != nil {
		return access.RoleSnapshot{}, werr
	}
	return buildRoleSnapshotByID(ctx, deps, code.OwnerID, code.AssumedRoleID,
		&codeOverlay{
			denials: denials, codePromptBody: codePrompt, waypoints: wps,
			requireGhostEvidence: code.RequireGhostEvidence,
		})
}

// loadCodeWaypoints —— reads a code's waypoint overlay. No Codes port (the eval facade
// / an older path hasn't wired it) → empty overlay, same behavior as before (fully
// inherits the role, backward-compatible).
func loadCodeWaypoints(
	ctx context.Context, deps *VisitorSessionDeps, codeID string,
) ([]access.Waypoint, error) {
	if deps.Codes == nil {
		return []access.Waypoint{}, nil
	}
	wps, err := deps.Codes.Waypoints(ctx, codeID)
	if err != nil {
		return []access.Waypoint{}, fmt.Errorf("list code waypoints: %w", err)
	}
	return wps, nil
}

// resolveCodePrompt / promptBodyByID live in visitor_code_prompt.go —— that layer's
// resolution rule (the two-layer stack) is substantial enough for its own file, while
// this file is the snapshot's assembly.

// roleDenials —— the capability / skill ids the code layer subtracts from the role
// grant (pure deny). Non-code paths (public + byoai) pass a zero value = subtract
// nothing.
type roleDenials struct {
	Caps   []string
	Skills []string
	// Corpus —— the URI globs this code retracts from the role's allow-list (the
	// corpus category among the three ACL kinds). Not removed from CorpusURIs: glob
	// subtraction can't delete a list entry, so it's frozen into its own column and
	// checked at match time (AllowsCorpusScope).
	Corpus []string
}

// loadCodeDenials —— reads a code's deny set. No CodeDenials port (the eval facade / an
// older path hasn't wired it) → zero denies, same behavior as before (backward-compatible).
func loadCodeDenials(
	ctx context.Context, deps *VisitorSessionDeps, codeID string,
) (roleDenials, error) {
	if deps.CodeDenials == nil {
		return roleDenials{}, nil
	}
	caps, err := deps.CodeDenials.ListCapabilities(ctx, codeID)
	if err != nil {
		return roleDenials{}, fmt.Errorf("list code capability denials: %w", err)
	}
	skills, err := deps.CodeDenials.ListSkills(ctx, codeID)
	if err != nil {
		return roleDenials{}, fmt.Errorf("list code skill denials: %w", err)
	}
	uris, uerr := deps.CodeDenials.ListCorpusURIs(ctx, codeID)
	if uerr != nil {
		return roleDenials{}, fmt.Errorf("list code corpus denials: %w", uerr)
	}
	return roleDenials{Caps: caps, Skills: skills, Corpus: uris}, nil
}

// APIKeyDenialReader —— read an API key's deny set (access.APIKeyRepo implements it).
// Same shape as the code denial reader; the api facade subtracts these from the role's grant.
type APIKeyDenialReader interface {
	ListCapabilityDenials(ctx context.Context, keyID string) ([]string, error)
	ListSkillDenials(ctx context.Context, keyID string) ([]string, error)
}

// BuildAPIKeyRoleSnapshot —— freeze the RoleSnapshot for an API key: the assumed role's
// grant minus the key's per-key denials. No per-key prompt (the api facade has no LLM
// persona) — snapshot only gates which capabilities/tools the key's HTTP calls may reach.
func BuildAPIKeyRoleSnapshot(
	ctx context.Context, deps *VisitorSessionDeps, denials APIKeyDenialReader,
	key *access.APIKey,
) (access.RoleSnapshot, error) {
	caps, err := denials.ListCapabilityDenials(ctx, key.ID)
	if err != nil {
		return access.RoleSnapshot{}, fmt.Errorf("list api key capability denials: %w", err)
	}
	skills, serr := denials.ListSkillDenials(ctx, key.ID)
	if serr != nil {
		return access.RoleSnapshot{}, fmt.Errorf("list api key skill denials: %w", serr)
	}
	return buildRoleSnapshotByID(ctx, deps, key.OwnerID, key.AssumedRoleID,
		&codeOverlay{denials: roleDenials{Caps: caps, Skills: skills}})
}

// buildRoleSnapshotForOwnerPublic —— public / byoai sessions use the owner's public
// role snapshot. If the owner hasn't customized public, it covers the three public
// globs: wiki/output/writing.
func buildRoleSnapshotForOwnerPublic(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string,
) (access.RoleSnapshot, error) {
	role, err := deps.Roles.GetByName(ctx, ownerID, access.PublicRoleName)
	if err != nil {
		return access.RoleSnapshot{}, fmt.Errorf("get public role: %w", err)
	}
	// public + byoai (non-code paths) have no per-code prompt, no denies.
	return buildRoleSnapshotByID(ctx, deps, ownerID, role.ID(), &codeOverlay{})
}

// codeOverlay —— what the code layer stacks on top of the role: the deny set + this
// code's own prompt body. Non-code paths (public + byoai) pass a zero value = no deny,
// no per-code prompt.
type codeOverlay struct {
	codePromptBody string
	denials        roleDenials
	// requireGhostEvidence —— F-A-10 per-code override (nil = inherits the role's
	// switch).
	requireGhostEvidence *bool
	// waypoints —— this code's ghost-steering overlay (empty = fully inherits the
	// role's). Placed last: a slice's len/cap has no pointer, so the GC scans 16 fewer
	// bytes (fieldalignment).
	waypoints []access.Waypoint
}

func buildRoleSnapshotByID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID, roleID string, overlay *codeOverlay,
) (access.RoleSnapshot, error) {
	role, err := deps.Roles.GetByID(ctx, ownerID, roleID)
	if err != nil {
		return access.RoleSnapshot{}, fmt.Errorf("get role for snapshot: %w", err)
	}
	promptBody, err := loadPromptBody(ctx, deps, ownerID, &role)
	if err != nil {
		return access.RoleSnapshot{}, err
	}
	// ACL code layer (capability-acl-hierarchy.md): a denied skill is removed right at
	// the assembly source, so its L1 prompt / tool grants / id all vanish together
	// (subtracting only from SkillIDs would leave the L1 prompt behind).
	skills, err := loadRoleSkills(ctx, deps, role.ID(), overlay.denials.Skills)
	if err != nil {
		return access.RoleSnapshot{}, err
	}
	return access.NewRoleSnapshot(&access.RoleSnapshotInit{
		FrozenAt:       time.Now(),
		RoleID:         role.ID(),
		RoleName:       role.Name(),
		PromptBody:     promptBody,
		CodePromptBody: overlay.codePromptBody,
		CorpusURIs:     role.CorpusURIs(),
		SkillPrompts:   skills.Prompts,
		AllowedTools:   skills.Tools,
		// Frozen into DeniedCapabilities; the exposure gate blocks on this, including
		// ACL=always caps (never in allowedTools, so only the gate can block them).
		DeniedCapabilities: overlay.denials.Caps,
		// Code layer's corpus narrowing: own column, checked as grant AND NOT deny
		// (AllowsCorpusScope) — a glob subtraction can't delete a list entry.
		DeniedCorpusURIs: overlay.denials.Corpus,
		// Phase C: only enabled, granted skill ids (bundle pre-filtered by enabled), so
		// a disabled skill neither enters L1 nor matches skill_use/skill_run_script.
		SkillIDs:     skills.IDs,
		MCPServerIDs: role.MCPServerIDs(),
		// #109/#110: role's ≤2 dock button configs; session payload layer resolves
		// title + filters code-deny.
		DockButtons: role.DockButtons(),
		// Role says which provider + whether metering is on; the code's value can
		// override, applied at session assembly.
		ProviderID: role.ProviderID(),
		GasMetered: role.GasMetered(),
		// ghost-steering: merge code's waypoint overlay onto the role's by waypoint_id
		// (role = audience destinations, code = this invitation's), THEN two floor
		// checks — filtering after merging so the overlay can't steer toward evidence
		// the role can't see: (1) authorization — evidence_refs outside the role's
		// granted globs drops the entry; (2) feasibility (F-A-26) — a non-terminal
		// waypoint whose refs resolve to no real note drops the entry. These two used
		// to share one name while only (1) ran, so a glob-matched but nonexistent note
		// became permanently unreachable and its ghost could never go quiet. See
		// visitor_waypoint_feasible.go.
		Waypoints: feasibleWaypoints(ctx, deps.CorpusRefs, ownerID, access.FilterWaypointsByCorpus(
			access.MergeWaypoints(role.Waypoints(), overlay.waypoints), role.CorpusURIs(),
		)),
		// F-A-10: code's override if non-nil, else role's value; used at ghost selection.
		RequireGhostEvidence: effectiveGhostEvidence(
			role.RequireGhostEvidence(), overlay.requireGhostEvidence,
		),
		// Per-capability config frozen alongside the role. This layer knows nothing
		// about the keys — replaces the old single NotifyOwnerOnBooking bool wired
		// into the kernel; now capability id → config, passed through unchanged for
		// the sandbox to read.
		CapConfig: roleCapConfig(ctx, deps, role.ID()),
	}), nil
}

// roleCapConfig —— at the moment of freezing, each capability's config on this role. No
// read port wired → empty map (not an error): an instance where no capability has ever
// declared per-role config is perfectly normal.
//
// A read failure shouldn't stop a session from opening either —— that layer logs it
// itself (see SubjectFields in capconfig).
func roleCapConfig(
	ctx context.Context, deps *VisitorSessionDeps, roleID string,
) map[string]json.RawMessage {
	if deps.RoleCapConfig == nil {
		return map[string]json.RawMessage{}
	}
	return deps.RoleCapConfig.ReadByCapability(ctx, roleID)
}

// effectiveGhostEvidence —— F-A-10's role/code merge: uses code if it explicitly
// overrides (non-nil), otherwise inherits role.
func effectiveGhostEvidence(roleVal bool, codeOverride *bool) bool {
	if codeOverride != nil {
		return *codeOverride
	}
	return roleVal
}

// loadPromptBody —— when the role has no prompt attached, or the attached prompt
// doesn't exist → returns empty string (a role like public doesn't necessarily have a
// prompt, the session is still fine).
func loadPromptBody(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, role *access.Role,
) (string, error) {
	promptID, ok := role.PromptID()
	if !ok {
		return "", nil
	}
	return promptBodyByID(ctx, deps, ownerID, &promptID)
}

// roleSkillBundle —— the bundled return of loadRoleSkills, avoiding the
// function-result-limit 3-return.
type roleSkillBundle struct {
	Prompts []string // Phase C / L1: each entry = a skill's name+description (not its body)
	Tools   []string
	IDs     []string // ids of enabled, granted skills (snapshot.SkillIDs → skill_use/run)
}

// loadRoleSkills —— assembles the prompts of the skills attached to a role into one
// group, and merges+dedupes allowed_tools into another.
func loadRoleSkills(
	ctx context.Context, deps *VisitorSessionDeps, roleID string, deniedSkills []string,
) (roleSkillBundle, error) {
	skills, lerr := deps.Skills.ListSkillsForRole(ctx, roleID)
	if lerr != nil {
		return roleSkillBundle{}, fmt.Errorf("list role skills: %w", lerr)
	}
	return collectRoleSkillBundle(filterDeniedSkills(skills, deniedSkills)), nil
}

// filterDeniedSkills —— the ACL code layer: strips out skills this code denies (by id).
// Removing at the source makes prompt / tool / id all vanish together. Empty deny →
// returned unchanged.
func filterDeniedSkills(skills []marketplace.Skill, denied []string) []marketplace.Skill {
	if len(denied) == 0 {
		return skills
	}
	out := make([]marketplace.Skill, 0, len(skills))
	for i := range skills {
		if !slices.Contains(denied, skills[i].ID) {
			out = append(out, skills[i])
		}
	}
	return out
}

// collectRoleSkillBundle —— ListSkillsForRole has already filtered by enabled. Phase C:
// the system prompt carries only name+description (L1 progressive disclosure), the body
// is only disclosed once the agent calls skill_use (L2); it also collects enabled skill
// ids frozen into the snapshot, so the binding only exposes skill_use/skill_run_script
// for enabled, granted skills.
func collectRoleSkillBundle(skills []marketplace.Skill) roleSkillBundle {
	prompts := make([]string, 0, len(skills))
	ids := make([]string, 0, len(skills))
	toolSet := make(map[string]struct{}, len(skills)*2)
	for i := range skills {
		ids = append(ids, skills[i].ID)
		if line := skillL1Line(&skills[i]); line != "" {
			prompts = append(prompts, line)
		}
		for _, t := range skills[i].AllowedTools {
			toolSet[t] = struct{}{}
		}
	}
	tools := make([]string, 0, len(toolSet))
	for t := range toolSet {
		tools = append(tools, t)
	}
	return roleSkillBundle{Prompts: prompts, Tools: tools, IDs: ids}
}

// skillL1Line —— the L1 line injected into the system prompt: name + a one-sentence
// description + a hint to call skill_use to read the body. Steers the agent to pull the
// body (L2) into context only when it's actually relevant.
func skillL1Line(s *marketplace.Skill) string {
	name := strings.TrimSpace(s.Name)
	if name == "" {
		return ""
	}
	line := fmt.Sprintf("skill %q", name)
	if d := strings.TrimSpace(s.Description); d != "" {
		line += ": " + d
	}
	return line + fmt.Sprintf(" (call skill_use(name=%q) to read its instructions)", name)
}

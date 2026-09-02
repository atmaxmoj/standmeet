// visitor_deps.go —— #131: the two deps aggregates for the visitor bounded context
// (session lifecycle + capability wiring raw materials). Split out of visitor.go to stay
// under max-lines; type definitions only, no logic.

package usecase

import (
	"context"
	"encoding/json"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// VisitorSessionDeps —— #131: what the visitor **session lifecycle** bounded context
// needs (code-issued session / public session / resume / history restore / quota
// derivation / code intro). Carries no tool/capability dependencies (those go through
// each capability's narrow deps + VisitorSkillsDeps). Half of the split-out god-struct.
type VisitorSessionDeps struct {
	Codes    *access.CodeRepo
	Chats    *repo.ChatRepo
	Owners   OwnerGetter
	Skills   SkillGetter // role snapshot freeze reads ListSkillsForRole
	Roles    *access.RoleRepo
	Prompts  *owner.PromptRepo
	Sessions *access.VisitorSessionStore
	Wiki     corpus.WikiLister // history restore hydrates the conversation view
	Writing  corpus.WritingLister
	Output   corpus.OutputLister
	// AgentSkills —— computes capability states / tool specs (retrieval / booker /
	// ext-mcp / owner-skill) at session assembly time.
	AgentSkills *capreg.Registry
	// CodeDenials —— the code layer of the ACL hierarchy (capability-acl-hierarchy.md).
	// buildRoleSnapshotForCode subtracts from the role grant based on this before
	// freezing. May be nil (the code-less public + byoai paths, or an older facade that
	// hasn't wired it → treated as zero denies).
	CodeDenials CodeDenialReader
	// RoleCapConfig —— reads "each capability's config on this role" when freezing the
	// role snapshot. Nil = no capability has ever declared per-role config (a perfectly
	// normal instance).
	RoleCapConfig RoleCapConfigReader
	// Gas —— the gas gauge (#7). Nil = this instance can't read gas level, so every
	// session is treated as unmetered —— failing to read gas level and locking everyone
	// out over it would punish the visitor for a diagnostic problem.
	Gas GasGauge
	// ProviderDefault —— freezes a session with no specified provider into the default
	// one (see providerDefaulter). Nil = doesn't resolve (an older facade hasn't wired
	// it), falls back to today's behavior: provider_id stays empty.
	ProviderDefault providerDefaulter
	// CorpusRefs —— asks "does this evidence_ref resolve to a real note" when freezing
	// waypoints (F-A-26). Nil = no feasibility filtering (see feasibleWaypoints).
	CorpusRefs CorpusRefResolver
}

// GasGauge —— how many tokens are left in a tank. nil = this tank has no metering
// attached.
//
// This layer knows nothing about owner_providers, nor about the usage table: that
// arithmetic lives in the owner domain (which manages the tank), the implementation is
// wired by the composition root. It only asks "how much is left," because what it
// blocks is "can this session send another one".
type GasGauge interface {
	Remaining(ctx context.Context, ownerID, providerID string) (*int64, error)
}

// providerDefaulter —— the owner's default provider id (returns empty string if
// unconfigured). At session issuance, "unspecified provider" gets frozen into a specific
// one, otherwise anonymous/public spending on the default key stays invisible to gas
// accounting and gates (pentest 2026-09-01).
type providerDefaulter interface {
	DefaultProviderID(ctx context.Context, ownerID string) (string, error)
}

// resolveSessionProviderID —— the provider id to freeze into the session. Uses it if
// already specified; if empty, freezes it to the owner's default so anonymous/public
// spending on the default key is visible to gas accounting and gates (pentest
// 2026-09-01). When deps.ProviderDefault is nil (an older facade hasn't wired it), falls
// back unchanged, returns raw —— same as today.
func resolveSessionProviderID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID, raw string,
) (string, error) {
	if raw != "" || deps.ProviderDefault == nil {
		return raw, nil
	}
	id, err := deps.ProviderDefault.DefaultProviderID(ctx, ownerID)
	if err != nil {
		return "", fmt.Errorf("resolve default provider: %w", err)
	}
	return id, nil
}

// resolveCodeSessionData —— freezes the snapshot, builds the session data, and freezes
// an unspecified provider into the owner's default one. When neither the code nor the
// role specifies a provider, an empty string would make this session's spending on the
// default key invisible to gas accounting/gates (pentest 2026-09-01) —— so it's resolved
// to a specific one right here. Lives here rather than in visitor.go: it's "assemble a
// session" plumbing, the same family as resolveSessionProviderID, and visitor.go has
// already hit the line-count cap.
func resolveCodeSessionData(
	ctx context.Context, deps *VisitorSessionDeps,
	code *access.Code, member *access.CodeMember, in *IssueCodeSessionInput,
) (*access.VisitorSessionData, error) {
	snapshot, serr := buildRoleSnapshotForCode(ctx, deps, code)
	if serr != nil {
		return nil, serr
	}
	sd := buildCodeSessionData(code, access.VisitorProfile{
		Name: in.VisitorName, Email: in.VisitorEmail,
	}, member.ID, &snapshot)
	providerID, perr := resolveSessionProviderID(ctx, deps, code.OwnerID, sd.ProviderID)
	if perr != nil {
		return nil, perr
	}
	sd.ProviderID = providerID
	return sd, nil
}

// RoleCapConfigReader —— reads each capability's own config, keyed by role: **capability
// id** → its config (a JSON object).
//
// This layer **never interprets any key inside it**, and shouldn't even know which
// capabilities exist —— so the seam has exactly one method, returning opaque JSON. The
// implementation lives in the composition root (only it knows capconfig and manifest
// declarations).
//
// The method is named ReadByCapability, not Read: the same implementation also has a
// Read that returns a **flattened field table** (field name → value), with the exact
// same Go type. If the names collided, a wrong wiring would compile silently, with the
// symptom that every capability reads a config that isn't its own.
type RoleCapConfigReader interface {
	ReadByCapability(ctx context.Context, roleID string) map[string]json.RawMessage
}

// History —— narrows down to the session read model's narrow dependency (HistoryDeps),
// feeding LoadVisitorView / ConversationForChat.
func (d *VisitorSessionDeps) History() *HistoryDeps {
	return &HistoryDeps{
		Codes: d.Codes, Chats: d.Chats,
		Wiki: d.Wiki, Writing: d.Writing, Output: d.Output,
	}
}

// CodeDenialReader —— reads a code's deny set (capability / skill id). Pure deny: a code
// can only cut further from what the chosen role already grants. access.CodeDenialRepo
// implements it.
type CodeDenialReader interface {
	ListCapabilities(ctx context.Context, codeID string) ([]string, error)
	ListSkills(ctx context.Context, codeID string) ([]string, error)
	// ListCorpusURIs —— the corpus category among the three ACL kinds: the globs this
	// code retracts from the role's allow-list.
	ListCorpusURIs(ctx context.Context, codeID string) ([]string, error)
}

// VisitorSkillsDeps —— #131: the **raw materials** needed to register visitor
// capabilities (the capability-wiring half). RegisterVisitorSkills builds each
// capability's narrow deps from this. Both prod wireup + the eval facade construct it.
// Doesn't leak into business logic, used only once at the registration seam.
type VisitorSkillsDeps struct {
	Wiki     corpus.WikiLister
	Output   corpus.OutputLister
	Writings corpus.WritingLister
	// #135: after booker was externalized to the sandbox, its raw materials
	// (CalendarProxy / booking store / owner / owner-notify) no longer enter here ——
	// booker fetches them itself through the fixed-vocabulary reach-back gateway.
	Skills     SkillGetter
	Sandbox    sandbox.Runner
	MCPServers MCPServerGetter
	Reports    ReportStore
	Resolver   inference.Resolver
	// DepConnected —— the named-connector dependency connectivity query (used by the
	// ext-mcp dep-grant gate: when a tool declares _meta.requires, it's allowed through
	// based on grant+connected). prod wires the connector DepRegistry; the eval facade
	// leaves it nil → ext-mcp dependent tools are always fail-closed hidden.
	DepConnected DepConnected
	// AgentConnectors —— the source that exposes an openapi connector's raw ops as
	// agent tools (§3). prod wires the composition root's adapter (ConnectorRepo +
	// Hub); nil → no agent tools exposed at all.
	AgentConnectors AgentConnectorSource
	// Resumes —— the source for the visitor-side resume-reading capability: fetches
	// this resume's JSON by the application's code. prod wires the composition root's
	// adapter (port.ResumesByCode); nil → this capability stays hidden permanently.
	Resumes ResumeSource
}

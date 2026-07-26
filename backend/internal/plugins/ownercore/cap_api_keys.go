package ownercore

// cap_api_keys.go —— owner-side API-key facade Capability (facade-directions.md). Key CRUD over
// owner MCP: api_keys.create / api_keys.list / api_keys.revoke / api_keys.update. The per-key
// denials and the api candidacy ("open") tools live in cap_api_keys_acl.go; update lives in
// cap_api_keys_update.go. owner-only; every per-key tool owner-scopes via GetByID (key_id is
// caller-supplied → reject others').

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/credentialdomain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const apiKeysBundle = "api_keys.bundle"

// apiKeyCRUD —— the key-row half of the repo surface (postgres.APIKeyRepo implements it). A
// superset of usecases.APIKeyStore ({Create}), so d.Keys also satisfies the mint usecase's dep.
type apiKeyCRUD interface {
	Create(
		ctx context.Context, in *credentialdomain.CreateAPIKeyInput,
	) (credentialdomain.APIKey, error)
	ListByOwner(ctx context.Context, ownerID string) ([]credentialdomain.APIKey, error)
	GetByID(ctx context.Context, id, ownerID string) (credentialdomain.APIKey, error)
	Revoke(ctx context.Context, id, ownerID string) error
	Update(
		ctx context.Context, in *credentialdomain.UpdateAPIKeyInput,
	) (credentialdomain.APIKey, error)
}

// apiKeyACLStore —— the per-key denial + owner-wide candidacy half (backs cap_api_keys_acl.go).
type apiKeyACLStore interface {
	ListCapabilityDenials(ctx context.Context, keyID string) ([]string, error)
	ListSkillDenials(ctx context.Context, keyID string) ([]string, error)
	AddCapabilityDenial(ctx context.Context, keyID, capabilityID string) error
	DeleteCapabilityDenial(ctx context.Context, keyID, capabilityID string) error
	AddSkillDenial(ctx context.Context, keyID, skillID string) error
	DeleteSkillDenial(ctx context.Context, keyID, skillID string) error
	OpenCapability(ctx context.Context, ownerID, capabilityID string) error
	CloseCapability(ctx context.Context, ownerID, capabilityID string) error
	ListOpenCapabilities(ctx context.Context, ownerID string) ([]string, error)
}

// apiKeyStore —— the whole narrow api_keys repo surface this bundle needs.
type apiKeyStore interface {
	apiKeyCRUD
	apiKeyACLStore
}

// APIKeysOwnerDeps —— newAPIKeysCapability 入参打包. Keys is the api_keys repo (also feeds the mint
// usecase); Roles validates the assumed role at mint (BOLA guard).
type APIKeysOwnerDeps struct {
	Keys  apiKeyStore
	Roles usecases.APIKeyRoleGetter
}

type apiKeysCapability struct {
	deps *APIKeysOwnerDeps
	log  *slog.Logger
}

func newAPIKeysCapability(deps *APIKeysOwnerDeps, log *slog.Logger) *apiKeysCapability {
	return &apiKeysCapability{deps: deps, log: log}
}

func (*apiKeysCapability) ID() string          { return apiKeysBundle }
func (*apiKeysCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*apiKeysCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*apiKeysCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*apiKeysCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *apiKeysCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return append([]*capreg.MCPBinding{
		c.createBinding(), c.listBinding(), c.revokeBinding(), c.updateBinding(),
	}, c.aclBindings()...)
}

// failf —— log an internal error under "cap <tool>" and return the user-facing "<tool> failed".
// Shared by every handler so the "err" log key is written in exactly one place.
func (c *apiKeysCapability) failf(tool string, err error) capreg.MCPResult {
	c.log.Error("cap "+tool, "err", err)
	return capreg.MCPError(tool + " failed")
}

// ───── api_keys.create ──────────────────────────────────────────

func (c *apiKeysCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.create",
		Description: "Mint an API key assuming a role. Returns the raw secret ONCE " +
			"(smk_…) plus its id and prefix; the secret is never retrievable again.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"label":{"type":"string","description":"Human label for the key."},
				"assumed_role_id":{"type":"string","description":"Role UUID the key assumes."},
				"rate_limit_rpm":{"type":"number","description":"Requests-per-minute cap."},
				"expires_at_rfc3339":{"type":"string","description":"Expiry (RFC3339)."}
			},
			"required":["label","assumed_role_id"]
		}`),
		Handler: c.handleCreate,
	}
}

type apiKeyCreateArgsWire struct {
	RateLimitRPM  *int32 `json:"rate_limit_rpm"`
	Label         string `json:"label"`
	AssumedRoleID string `json:"assumed_role_id"`
	ExpiresAt     string `json:"expires_at_rfc3339"`
}

type apiKeyCreateArgs struct {
	ExpiresAt     *time.Time
	RateLimitRPM  *int32
	Label         string
	AssumedRoleID string
}

type apiKeyCreateView struct {
	ID     string `json:"id"`
	Prefix string `json:"prefix"`
	Secret string `json:"secret"`
}

// expiryResult —— wraps the parsed *time.Time so the parser never returns a bare (nil, nil).
type expiryResult struct {
	At *time.Time
}

func parseExpiry(s string) (expiryResult, error) {
	if s == "" {
		return expiryResult{}, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return expiryResult{}, errors.New("expires_at_rfc3339 must be an RFC3339 timestamp")
	}
	return expiryResult{At: &t}, nil
}

func parseAPIKeyCreateArgs(raw json.RawMessage) (apiKeyCreateArgs, error) {
	var w apiKeyCreateArgsWire
	if err := json.Unmarshal(raw, &w); err != nil {
		return apiKeyCreateArgs{}, errors.New("invalid arguments: " + err.Error())
	}
	if w.Label == "" {
		return apiKeyCreateArgs{}, errors.New("label is required")
	}
	if w.AssumedRoleID == "" {
		return apiKeyCreateArgs{}, errors.New("assumed_role_id is required")
	}
	exp, err := parseExpiry(w.ExpiresAt)
	if err != nil {
		return apiKeyCreateArgs{}, err
	}
	return apiKeyCreateArgs{
		Label: w.Label, AssumedRoleID: w.AssumedRoleID,
		RateLimitRPM: w.RateLimitRPM, ExpiresAt: exp.At,
	}, nil
}

func (c *apiKeysCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseAPIKeyCreateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	issued, err := usecases.IssueAPIKey(ctx, usecases.IssueAPIKeyDeps{
		Keys: c.deps.Keys, Roles: c.deps.Roles,
	}, &usecases.IssueAPIKeyInput{
		OwnerID: ownerID, AssumedRoleID: args.AssumedRoleID, Label: args.Label,
		RateLimitRPM: args.RateLimitRPM, ExpiresAt: args.ExpiresAt,
	})
	if err != nil {
		return c.createErr(err)
	}
	return mcputil.MarshalResult(c.log, "api_keys.create", apiKeyCreateView{
		ID: issued.Key.ID, Prefix: issued.Key.Prefix, Secret: issued.Secret,
	})
}

func (c *apiKeysCapability) createErr(err error) capreg.MCPResult {
	if errors.Is(err, usecases.ErrAPIKeyLabelRequired) ||
		errors.Is(err, usecases.ErrAPIKeyRoleRequired) {
		return capreg.MCPError(err.Error())
	}
	return c.failf("api_keys.create", err)
}

// ───── api_keys.list ────────────────────────────────────────────

func (c *apiKeysCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.list",
		Description: "List all API keys for the owner (id / label / prefix / assumed " +
			"role / status / rate limit / expiry / last-used). The secret is never returned.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type apiKeyRowView struct {
	RateLimitRPM  *int32 `json:"rate_limit_rpm,omitempty"`
	ID            string `json:"id"`
	Label         string `json:"label"`
	Prefix        string `json:"prefix"`
	Status        string `json:"status"`
	AssumedRoleID string `json:"assumed_role_id"`
	ExpiresAt     string `json:"expires_at,omitempty"`
	LastUsedAt    string `json:"last_used_at,omitempty"`
	CreatedAt     string `json:"created_at"`
}

func (c *apiKeysCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := c.deps.Keys.ListByOwner(ctx, ownerID)
	if err != nil {
		return c.failf("api_keys.list", err)
	}
	out := make([]apiKeyRowView, 0, len(rows))
	for i := range rows {
		out = append(out, apiKeyRowToView(&rows[i]))
	}
	return mcputil.MarshalResult(c.log, "api_keys.list", out)
}

func apiKeyRowToView(k *credentialdomain.APIKey) apiKeyRowView {
	v := apiKeyRowView{
		ID: k.ID, Label: k.Label, Prefix: k.Prefix, Status: k.Status,
		AssumedRoleID: k.AssumedRoleID, RateLimitRPM: k.RateLimitRPM,
		CreatedAt: k.CreatedAt.Format(time.RFC3339),
	}
	if k.ExpiresAt != nil {
		v.ExpiresAt = k.ExpiresAt.Format(time.RFC3339)
	}
	if k.LastUsedAt != nil {
		v.LastUsedAt = k.LastUsedAt.Format(time.RFC3339)
	}
	return v
}

// ───── api_keys.revoke ──────────────────────────────────────────

func (c *apiKeysCapability) revokeBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.revoke",
		Description: "Revoke an API key by id. The key stops authenticating immediately. " +
			"Idempotent on already-revoked keys.",
		InputSchema: apiKeyIDSchema(),
		Handler:     c.handleRevoke,
	}
}

func apiKeyIDSchema() json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"API key UUID."}
		},
		"required":["id"]
	}`)
}

type apiKeyIDArgsWire struct {
	ID string `json:"id"`
}

func parseAPIKeyIDArg(raw json.RawMessage) (string, error) {
	var args apiKeyIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return "", errors.New("invalid arguments: " + err.Error())
	}
	if args.ID == "" {
		return "", errors.New("id is required")
	}
	return args.ID, nil
}

func (c *apiKeysCapability) handleRevoke(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	id, perr := parseAPIKeyIDArg(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.deps.Keys.Revoke(ctx, id, ownerID); err != nil {
		return c.failf("api_keys.revoke", err)
	}
	return mcputil.MarshalResult(c.log, "api_keys.revoke", map[string]any{
		"id": id, "revoked": true,
	})
}

// api_keys.update is in cap_api_keys_update.go (split out 守 max-lines).

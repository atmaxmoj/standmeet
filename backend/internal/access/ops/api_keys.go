// api_keys.go —— 资源 api_keys:owner 发给程序用的钥匙。
//
// 一把 key 假装成一个 role(跟邀请码同一个模型),所以它能做什么由那个 role 说了算,
// 再叠上 per-key 的收窄(见 api_keys_acl.go)。
//
// 这一组**只在 MCP 上**:api-key facade 是 MCP-first 的(facade-directions.md),
// 面板上没有它的页面。这是写下来的单面决定,所以 Reach 上写明理由,而不是让 parity 去猜。
//
// 每个 per-key 的操作都先按 owner 核一遍 key_id(key_id 是调用方给的 —— 不核就是 BOLA)。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// APIKeysDeps —— key 仓储 + 发钥匙时校验 role 的口子 + "哪些能力可以开给 API 面"。
//
// APICandidates 是注入的:能开给 API 的是**哪些能力**,那是能力轴的知识,不是 access 的。
type APIKeysDeps struct {
	Keys          *repo.APIKeyRepo
	Roles         usecase.APIKeyRoleGetter
	APICandidates func() []string
}

// mcpOnly —— 这一组为什么只长在 MCP 上。
func mcpOnly() fp.Reach {
	return fp.Only(
		"the API-key facade is MCP-first (facade-directions.md); the panel has no page for it",
		"mcp")
}

// APIKeys —— create / list / revoke / update,外加 ACL 那半边(api_keys_acl.go)。
func APIKeys(d APIKeysDeps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "api_keys.create",
			Description: "Mint an API key assuming a role. Returns the raw secret ONCE " +
				"(smk_…) plus its id and prefix; the secret is never retrievable again.",
			InputSchema: apiKeyCreateSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      createAPIKey(d),
		},
		{
			ID: "api_keys.list",
			Description: "List all API keys for the owner (id / label / prefix / assumed " +
				"role / status / rate limit / expiry / last-used). The secret is never returned.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       mcpOnly(),
			Invoke:      listAPIKeys(d),
		},
		{
			ID: "api_keys.revoke",
			Description: "Revoke an API key by id. The key stops authenticating immediately. " +
				"Idempotent on already-revoked keys.",
			InputSchema: apiKeyIDSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      revokeAPIKey(d),
		},
		{
			ID: "api_keys.update",
			Description: "Update an API key's label and/or rate limit. Omit a field to keep it; " +
				"pass rate_limit_rpm as null to clear to instance default.",
			InputSchema: apiKeyUpdateSchema,
			Kind:        fp.Action,
			Reach:       mcpOnly(),
			Invoke:      updateAPIKey(d),
		},
	}, apiKeyACLOps(d)...)
}

var (
	apiKeyIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"API key UUID."}},
		"required":["id"]
	}`)

	apiKeyCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"label":{"type":"string","description":"Human label for the key."},
			"assumed_role_id":{"type":"string","description":"Role UUID the key assumes."},
			"rate_limit_rpm":{"type":"number","description":"Requests-per-minute cap."},
			"expires_at_rfc3339":{"type":"string","description":"Expiry (RFC3339)."}
		},
		"required":["label","assumed_role_id"]
	}`)

	apiKeyUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"API key UUID."},
			"label":{"type":"string","description":"New label."},
			"rate_limit_rpm":{"type":["number","null"],"description":"RPM cap."}
		},
		"required":["id"]
	}`)
)

// apiKeyCreatedOut —— 明文密钥只在这一次出现,之后再也取不回来。
type apiKeyCreatedOut struct {
	ID     string `json:"id"`
	Prefix string `json:"prefix"`
	Secret string `json:"secret"`
}

// apiKeyOut —— 一把 key 的出站形状(不含密钥)。
type apiKeyOut struct {
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

func toAPIKeyOut(k *entity.APIKey) apiKeyOut {
	v := apiKeyOut{
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

type apiKeyCreateArgs struct {
	RateLimitRPM  *int32 `json:"rate_limit_rpm"`
	expires       *time.Time
	Label         string `json:"label"`
	AssumedRoleID string `json:"assumed_role_id"`
	ExpiresAt     string `json:"expires_at_rfc3339"`
}

func createAPIKey(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeAPIKeyCreate(raw)
		if perr != nil {
			return nil, perr
		}
		issued, err := usecase.IssueAPIKey(ctx, usecase.IssueAPIKeyDeps{
			Keys: d.Keys, Roles: d.Roles,
		}, &usecase.IssueAPIKeyInput{
			OwnerID: ownerID, AssumedRoleID: in.AssumedRoleID, Label: in.Label,
			RateLimitRPM: in.RateLimitRPM, ExpiresAt: in.expires,
		})
		if err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiKeyCreatedOut{
			ID: issued.Key.ID, Prefix: issued.Key.Prefix, Secret: issued.Secret,
		})
	}
}

func decodeAPIKeyCreate(raw json.RawMessage) (apiKeyCreateArgs, error) {
	var in apiKeyCreateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"label", in.Label},
		[2]string{"assumed_role_id", in.AssumedRoleID}); err != nil {
		return in, err
	}
	expires, eerr := parseAPIKeyExpiry(in.ExpiresAt)
	in.expires = expires
	return in, eerr
}

// parseAPIKeyExpiry —— 空 = 不过期,不是错。
func parseAPIKeyExpiry(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // 空 = 没设,不是错误
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, fp.BadInput("expires_at_rfc3339 must be an RFC3339 timestamp")
	}
	return &t, nil
}

func listAPIKeys(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := d.Keys.ListByOwner(ctx, ownerID)
		if err != nil {
			return nil, apiKeyErr(err)
		}
		out := make([]apiKeyOut, 0, len(rows))
		for i := range rows {
			out = append(out, toAPIKeyOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

type apiKeyIDArgs struct {
	ID string `json:"id"`
}

func parseAPIKeyID(raw json.RawMessage) (string, error) {
	var in apiKeyIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

type apiKeyRevokedOut struct {
	ID      string `json:"id"`
	Revoked bool   `json:"revoked"`
}

func revokeAPIKey(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseAPIKeyID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := d.Keys.Revoke(ctx, id, ownerID); err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(apiKeyRevokedOut{ID: id, Revoked: true})
	}
}

type apiKeyUpdateArgs struct {
	Label        *string          `json:"label"`
	ID           string           `json:"id"`
	RateLimitRPM fp.OptionalInt32 `json:"rate_limit_rpm"`
}

func updateAPIKey(d APIKeysDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeAPIKeyUpdate(raw)
		if perr != nil {
			return nil, perr
		}
		row, err := d.Keys.Update(ctx, &entity.UpdateAPIKeyInput{
			ID: in.ID, OwnerID: ownerID, Label: in.Label,
			RateLimitRPM: in.RateLimitRPM.Value, SetRate: in.RateLimitRPM.Set,
		})
		if err != nil {
			return nil, apiKeyErr(err)
		}
		return json.Marshal(toAPIKeyOut(&row))
	}
}

func decodeAPIKeyUpdate(raw json.RawMessage) (apiKeyUpdateArgs, error) {
	var in apiKeyUpdateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

// apiKeyErr —— 域的哨兵 → 协议无关的类别。
func apiKeyErr(err error) error {
	for _, c := range apiKeyErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("api key op", err)
}

var apiKeyErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{usecase.ErrAPIKeyLabelRequired, func() error { return fp.BadInput("label is required") }},
	{usecase.ErrAPIKeyRoleRequired, func() error {
		return fp.BadInput("assumed_role_id is required")
	}},
	{entity.ErrAPIKeyNotFound, func() error { return fp.NotFound("api key not found") }},
}

// api_keys.go — resource api_keys: keys the owner issues for programs to use.
//
// A key impersonates a role (same model as an invitation code), so what it can do is decided
// by that role, then layered with per-key narrowing (see api_keys_acl.go).
//
// This group is **MCP-only**: the api-key facade is MCP-first (facade-directions.md), the
// panel has no page for it. This is a written, single-facade decision, so the reason is spelled
// out on Reach rather than left for parity checking to guess at.
//
// Every per-key operation first checks key_id against the owner (key_id is caller-supplied —
// skipping that check is a BOLA).

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

// APIKeysDeps — the key repo + the seam for validating a role when issuing a key + "which
// capabilities may be opened to the API facade".
//
// APICandidates is injected: **which capabilities** may open to the API facade is knowledge
// that belongs to the capability axis, not to access.
type APIKeysDeps struct {
	Keys  *repo.APIKeyRepo
	Roles usecase.APIKeyRoleGetter
	// Extras — the fields each capability occupies on **this key** (calendar.book's
	// max_bookings was the first). Same seam, same declaration as the one on codes, just a
	// different mount point. Without it, "how many bookings this key allows at most" has
	// nowhere to be set, and a quota can't exist (F-B-11).
	Extras        KeyExtras
	APICandidates func() []string
}

// This group **grows on both owner facades** (F-K-1).
//
// It used to be `fp.Only("…MCP-first…; the panel has no page for it", "mcp")` — the second half
// of that sentence used an absence as its justification: reach was pinned to MCP because the
// panel had no page, and the panel had no page because nobody built one. The design decided the
// opposite (`docs/design/facade-directions.md:202-206`): admin HTTP's `/api/admin/api-keys`
// CRUD + revoke, the admin UI's api section (list/mint/revoke), and owner-MCP **twins** — the
// same page also says "owner-plane ratchet forces twins by construction".
//
// This isn't a convenience issue: with only the MCP half, **a leaked key can only be revoked
// after the owner has installed and is running an MCP client**.

// APIKeys — create / list / revoke / update, plus the ACL half (api_keys_acl.go).
func APIKeys(d APIKeysDeps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "api_keys.create",
			Description: "Mint an API key assuming a role. Returns the raw secret ONCE " +
				"(smk_…) plus its id and prefix; the secret is never retrievable again.",
			// The fields each capability occupies on the key grow along with it
			// (max_bookings…), same mechanism as the code-issuing side.
			InputSchema: withExtraFields(apiKeyCreateSchema, extrasOr(d.Extras).Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createAPIKey(d),
		},
		{
			ID: "api_keys.list",
			Description: "List all API keys for the owner (id / label / prefix / assumed " +
				"role / status / rate limit / expiry / last-used). The secret is never returned.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listAPIKeys(d),
		},
		{
			ID: "api_keys.revoke",
			Description: "Revoke an API key by id. The key stops authenticating immediately. " +
				"Idempotent on already-revoked keys.",
			InputSchema: apiKeyIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      revokeAPIKey(d),
		},
		{
			ID: "api_keys.update",
			Description: "Update an API key's label and/or rate limit. Omit a field to keep it; " +
				"pass rate_limit_rpm as null to clear to instance default.",
			InputSchema: apiKeyUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
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

// apiKeyCreatedOut — the plaintext secret appears only this once; it can never be retrieved
// again after this.
type apiKeyCreatedOut struct {
	ID     string `json:"id"`
	Prefix string `json:"prefix"`
	Secret string `json:"secret"`
}

// apiKeyOut — a key's outbound shape (no secret).
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
		// Each capability picks its own fields (max_bookings…) out of the raw input and
		// stores them on this key. Best-effort: the key is already minted, so one
		// capability's storage failing shouldn't turn this into a failed minting.
		extrasOr(d.Extras).Write(ctx, issued.Key.ID, raw)
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

// parseAPIKeyExpiry — empty = never expires, not an error.
func parseAPIKeyExpiry(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty = unset, not an error
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
		extras := extrasOr(d.Extras)
		out := make([]json.RawMessage, 0, len(rows))
		for i := range rows {
			one, merr := marshalAPIKey(ctx, extras, &rows[i])
			if merr != nil {
				return nil, merr
			}
			out = append(out, one)
		}
		return json.Marshal(out)
	}
}

// marshalAPIKey — a key + the fields other capabilities put on it (max_bookings…).
//
// Reading back goes through the same seam as writing: if it only wrote and never read, a cap
// the owner set would be invisible in the list, and "a setting you can't see" looks identical
// on screen to "never set".
func marshalAPIKey(
	ctx context.Context, extras KeyExtras, k *entity.APIKey,
) (json.RawMessage, error) {
	row, err := json.Marshal(toAPIKeyOut(k))
	if err != nil {
		return nil, fp.OpErr("encode api key", err)
	}
	return withExtraValues(row, extras.Read(ctx, k.ID)), nil
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

// apiKeyErr — domain sentinel → protocol-agnostic category.
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

package ownercore

// cap_api_keys_update.go —— the api_keys.update tool (split out of cap_api_keys.go 守 max-lines).
// Partial update: label updates when present; rate_limit_rpm is "set" only when its json key is
// present (null → clear to instance default), matching domain.UpdateAPIKeyInput.

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

func (c *apiKeysCapability) updateBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "api_keys.update",
		Description: "Update an API key's label and/or rate limit. Omit a field to keep it; " +
			"pass rate_limit_rpm as null to clear to instance default.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"API key UUID."},
				"label":{"type":"string","description":"New label."},
				"rate_limit_rpm":{"type":["number","null"],"description":"RPM cap."}
			},
			"required":["id"]
		}`),
		Handler: c.handleUpdate,
	}
}

type apiKeyUpdateArgsWire struct {
	Label        *string         `json:"label"`
	ID           string          `json:"id"`
	RateLimitRPM json.RawMessage `json:"rate_limit_rpm"`
}

type apiKeyUpdateArgs struct {
	Label        *string
	RateLimitRPM *int32
	ID           string
	SetRate      bool
}

// optInt32 —— an update quota field: Set is true only when its json key was present; Val is the
// value (nil when the key was present as null → clears to instance default).
type optInt32 struct {
	Val *int32
	Set bool
}

func parseOptInt32(raw json.RawMessage, field string) (optInt32, error) {
	if len(raw) == 0 {
		return optInt32{}, nil
	}
	var v *int32
	if err := json.Unmarshal(raw, &v); err != nil {
		return optInt32{}, errors.New(field + " must be a number or null")
	}
	return optInt32{Val: v, Set: true}, nil
}

func parseAPIKeyUpdateArgs(raw json.RawMessage) (apiKeyUpdateArgs, error) {
	var w apiKeyUpdateArgsWire
	if err := json.Unmarshal(raw, &w); err != nil {
		return apiKeyUpdateArgs{}, errors.New("invalid arguments: " + err.Error())
	}
	if w.ID == "" {
		return apiKeyUpdateArgs{}, errors.New("id is required")
	}
	rate, rerr := parseOptInt32(w.RateLimitRPM, "rate_limit_rpm")
	if rerr != nil {
		return apiKeyUpdateArgs{}, rerr
	}
	return apiKeyUpdateArgs{
		Label: w.Label, ID: w.ID, RateLimitRPM: rate.Val, SetRate: rate.Set,
	}, nil
}

func (c *apiKeysCapability) handleUpdate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseAPIKeyUpdateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	row, err := c.deps.Keys.Update(ctx, &domain.UpdateAPIKeyInput{
		ID: args.ID, OwnerID: ownerID, Label: args.Label,
		RateLimitRPM: args.RateLimitRPM, SetRate: args.SetRate,
	})
	if err != nil {
		if errors.Is(err, domain.ErrAPIKeyNotFound) {
			return capreg.MCPError("api key not found")
		}
		return c.failf("api_keys.update", err)
	}
	return mcputil.MarshalResult(c.log, "api_keys.update", apiKeyRowToView(&row))
}

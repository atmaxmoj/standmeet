// cap_codes_create.go —— Phase E-13 拆出来守 max-lines。codes.create 单 tool
// + 入参 parse + build。codes.update_quotas 仍在 cap_codes.go。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

func (c *codesCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "codes.create",
		Description: "Issue a new access code. assumed_role_id required (use role_list / " +
			"role_create to pick one). Returns plaintext code + the persisted record.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"code":{"type":"string","description":"Plaintext code, e.g. 'RECRUIT-XYZ'."},
				"label":{"type":"string","description":"Owner-facing label."},
				"purpose":{"type":"string","description":"Optional purpose tag."},
				"assumed_role_id":{"type":"string","description":"role_id from role_list."},
				"ghosts":{"type":"array","items":{"type":"string"}},
				"expires_at_rfc3339":{"type":"string",
					"description":"Optional RFC3339 expiry timestamp."},
				"max_members":{"type":"number"},
				"max_turns_per_session":{"type":"number"},
				"max_bookings":{"type":"number"}
			},
			"required":["code","label","assumed_role_id"]
		}`),
		Handler: c.handleCreate,
	}
}

type createCodeArgsWire struct {
	MaxMembers    *int32   `json:"max_members"`
	MaxTurns      *int32   `json:"max_turns_per_session"`
	MaxBookings   *int32   `json:"max_bookings"`
	Code          string   `json:"code"`
	Label         string   `json:"label"`
	Purpose       string   `json:"purpose"`
	AssumedRoleID string   `json:"assumed_role_id"`
	ExpiresAt     string   `json:"expires_at_rfc3339"`
	Ghosts        []string `json:"ghosts"`
}

func (c *codesCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseCreateCodeArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	in, ierr := buildCreateCodeInputCap(&args, ownerID)
	if ierr != nil {
		return capreg.MCPError(ierr.Error())
	}
	code, err := c.codes.CreateAccessCode(ctx, in)
	if err != nil {
		c.log.Error("cap codes.create", "err", err)
		return capreg.MCPError("create code failed")
	}
	c.writeBookingQuota(ctx, code.ID, args.MaxBookings)
	return mcputil.MarshalResult(c.log, "codes.create", map[string]any{
		"code_id": code.ID, "code": code.Code, "label": code.Label,
	})
}

// readBookingQuota —— 列码回显时从 booker 读这张码的预约上限(best-effort:失败当无上限)。
func (c *codesCapability) readBookingQuota(ctx context.Context, codeID string) *int32 {
	if c.quota == nil {
		return nil
	}
	maxBookings, err := c.quota.MaxBookingsOf(ctx, codeID)
	if err != nil {
		c.log.Warn("cap codes.list: read booking quota", "err", err)
		return nil
	}
	return maxBookings
}

// writeBookingQuota —— 把 max_bookings 落 booker(best-effort:失败只 warn,不挡发码)。
func (c *codesCapability) writeBookingQuota(
	ctx context.Context, codeID string, maxBookings *int32,
) {
	if c.quota == nil || maxBookings == nil {
		return
	}
	if err := c.quota.SetMaxBookings(ctx, codeID, maxBookings); err != nil {
		c.log.Warn("cap codes.create: set booking quota", "err", err)
	}
}

func parseCreateCodeArgs(raw json.RawMessage) (createCodeArgsWire, error) {
	var args createCodeArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Code == "" {
		return args, errors.New("code is required")
	}
	if args.Label == "" {
		return args, errors.New("label is required")
	}
	if args.AssumedRoleID == "" {
		return args, errors.New("assumed_role_id is required")
	}
	return args, nil
}

func buildCreateCodeInputCap(
	args *createCodeArgsWire, ownerID string,
) (*access.CreateAccessCodeInput, error) {
	in := &access.CreateAccessCodeInput{
		OwnerID: ownerID, Code: args.Code, Label: args.Label,
		Purpose: args.Purpose, AssumedRoleID: args.AssumedRoleID,
		Ghosts:             mcputil.NonNilStrings(args.Ghosts),
		MaxMembers:         args.MaxMembers,
		MaxTurnsPerSession: args.MaxTurns,
	}
	if args.ExpiresAt != "" {
		t, terr := time.Parse(time.RFC3339, args.ExpiresAt)
		if terr != nil {
			return nil, fmt.Errorf("expires_at_rfc3339 parse: %w", terr)
		}
		in.ExpiresAt = &t
	}
	return in, nil
}

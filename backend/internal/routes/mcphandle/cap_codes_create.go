// cap_codes_create.go —— Phase E-13 拆出来守 max-lines。codes.create 单 tool
// + 入参 parse + build。codes.update_quotas 仍在 cap_codes.go。

package mcphandle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
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
	return marshalCapResult(c.log, "codes.create", map[string]any{
		"code_id": code.ID, "code": code.Code, "label": code.Label,
	})
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
) (*domain.CreateAccessCodeInput, error) {
	in := &domain.CreateAccessCodeInput{
		OwnerID: ownerID, Code: args.Code, Label: args.Label,
		Purpose: args.Purpose, AssumedRoleID: args.AssumedRoleID,
		Ghosts:             nonNilStrings(args.Ghosts),
		MaxMembers:         args.MaxMembers,
		MaxTurnsPerSession: args.MaxTurns,
		MaxBookings:        args.MaxBookings,
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

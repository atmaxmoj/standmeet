// codes_write.go — arg decoding and forwarding for issue / revoke / update-quota / update-
// evidence-switch (declared in codes.go).
//
// The rules themselves live in usecase/codes.go: no role specified uses the public role,
// revoking a code also clears its sessions, an unmentioned quota keeps its current value. This
// file only translates the wire JSON into the domain's input, then translates the result back.

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

type codeCreateArgs struct {
	MaxMembers         *int32              `json:"max_members"`
	MaxTurnsPerSession *int32              `json:"max_turns_per_session"`
	PromptID           *string             `json:"prompt_id"`
	LimitPerPeriod     *entity.PeriodLimit `json:"limit_per_period"`
	Code               string              `json:"code"`
	Label              string              `json:"label"`
	Purpose            string              `json:"purpose"`
	AssumedRoleID      string              `json:"assumed_role_id"`
	ExpiresAt          string              `json:"expires_at"`
	ProviderID         string              `json:"provider_id"`
	Ghosts             []string            `json:"ghosts"`
}

func createCode(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCodeCreate(raw, ownerID)
		if perr != nil {
			return nil, perr
		}
		code, err := usecase.IssueCode(ctx, deps, in)
		if err != nil {
			return nil, codeErr(err)
		}
		if berr := bindBundle(ctx, deps, ownerID, &code, raw); berr != nil {
			return nil, berr
		}
		extras.Write(ctx, code.ID, raw)
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

// bundleArgs — the one field this file reads out of the create body on its own.
type bundleArgs struct {
	Bundle string `json:"bundle"`
}

// bindBundle — bind the freshly issued code to the bundle the owner picked.
//
// A second step rather than a column on CreateCodeInput, because the two answer to
// different owners: issuing is the access domain's, and which blocks a code carries is
// the plugin substrate's. Threading a bundle name through the create path would put the
// plugin model's vocabulary inside the code entity's constructor.
//
// A name that does not resolve is an ERROR, not a silent skip. The owner picked
// "recruiter" and pressed issue; handing back a code that quietly carries the role's
// whole grant instead is the failure mode with teeth — they would believe they narrowed
// it. The code is already written by then, so the error names what did not happen.
func bindBundle(
	ctx context.Context, deps usecase.CodesDeps, ownerID string,
	code *entity.Code, raw json.RawMessage,
) error {
	want := bundleNameIn(raw)
	if want == "" {
		return nil
	}
	name, berr := deps.Codes.SetBundle(ctx, ownerID, code.ID, want)
	if berr != nil {
		return fp.BadInput("no bundle called " + want +
			" — the code was issued but carries no bundle")
	}
	code.Bundle = name
	return nil
}

// bundleNameIn — the bundle the caller named, or "" for "named none".
//
// A decode failure is the same fact as naming none: these are the same bytes the caller
// already decoded into the create args, so the only way this fails is a shape that carried no
// `bundle` field at all. Saying that here, once, keeps the caller free of an
// `err != nil || …` that reads as if a real error were being dropped.
func bundleNameIn(raw json.RawMessage) string {
	var in bundleArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return ""
	}
	return in.Bundle
}

// decodeCodeCreate — decode args. Leaving code empty or assumed_role_id empty are both valid:
// the former is derived by the domain, the latter falls back to the public role in the domain.
func decodeCodeCreate(raw json.RawMessage, ownerID string) (*repo.CreateCodeInput, error) {
	var in codeCreateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	expires, eerr := parseOptionalRFC3339(in.ExpiresAt)
	if eerr != nil {
		return nil, eerr
	}
	return &repo.CreateCodeInput{
		OwnerID: ownerID, Code: in.Code, Label: in.Label,
		Purpose: in.Purpose, Ghosts: nonNilStrings(in.Ghosts),
		AssumedRoleID: in.AssumedRoleID, PromptID: in.PromptID,
		MaxMembers: in.MaxMembers, MaxTurnsPerSession: in.MaxTurnsPerSession,
		ExpiresAt: expires,
		// empty = not specified: inherits the role's, then falls back to the owner default.
		ProviderID:     in.ProviderID,
		LimitPerPeriod: in.LimitPerPeriod,
	}, nil
}

// parseOptionalRFC3339 — empty = not set (never expires), not an error.
func parseOptionalRFC3339(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty = unset, not an error
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, fp.BadInput("expires_at must be RFC3339 or empty")
	}
	return &t, nil
}

// revokedOut — the revoke receipt. It isn't a code row, it's "what was done to which code",
// so its field is named after the **input** (code_id), not the row's id.
type revokedOut struct {
	CodeID  string `json:"code_id"`
	Revoked bool   `json:"revoked"`
}

func revokeCode(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.RevokeCode(ctx, deps, ownerID, id); err != nil {
			return nil, codeErr(err)
		}
		return json.Marshal(revokedOut{CodeID: id, Revoked: true})
	}
}

// rotateOp — codes.rotate. Lives here (not codeCoreOps) to keep codes.go under its line budget.
func rotateOp(d CodesDeps) fp.Op {
	return fp.Op{
		ID: "codes.rotate",
		Description: "Rotate a code's STRING (leak recovery). The new string replaces the old; " +
			"anything keyed on the code id (embeds, application rows) keeps working, but every " +
			"already-distributed copy of the OLD string — a résumé PDF/QR sent, a shared ?code= " +
			"link — stops working, and the code's live sessions are cleared.",
		InputSchema: codeRotateSchema,
		Kind:        fp.Action,
		Reach:       fp.OwnerAction(),
		Invoke:      rotateCode(d.Codes, extrasOr(d.Extras)),
	}
}

var codeRotateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"code_id":{"type":"string","description":"Access code id."},
		"code":{"type":"string","description":"The new code string (a single URL-safe token)."}
	},
	"required":["code_id","code"]
}`)

// codeRotateArgs — input for codes.rotate: which code (id), and its new string.
type codeRotateArgs struct {
	CodeID string `json:"code_id"`
	Code   string `json:"code"`
}

func rotateCode(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeRotateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		code, err := usecase.RotateCode(ctx, deps, ownerID, in.CodeID, in.Code)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

// codePageArgs — input for codes.set_microsite. slug empty string = unbind.
type codePageArgs struct {
	CodeID string `json:"code_id"`
	Slug   string `json:"slug"`
}

// setCodeMicrosite — points this code at a page, or clears it.
//
// **The binding lives on the code** (access_codes.microsite_id), so "at most one page per
// code" is guaranteed by structure, not by validation; the page side sees "which codes open
// me" — the same fact read from two places, neither side storing a second copy.
func setCodeMicrosite(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codePageArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if perr := fp.RequireArgs([2]string{"code_id", in.CodeID}); perr != nil {
			return nil, perr
		}
		code, err := usecase.SetCodeMicrosite(ctx, deps, ownerID, in.CodeID, in.Slug)
		if err != nil {
			return nil, codeErr(err)
		}
		return json.Marshal(codePageOut{CodeID: code.ID, MicrositeSlug: code.MicrositeSlug})
	}
}

// codePageOut — the binding receipt: **the slug read back**, not an echo of the input.
// An echo only proves "I received it"; a read-back proves "this is how it is now"
// ([[write-with-no-receipt]]).
type codePageOut struct {
	CodeID        string `json:"code_id"`
	MicrositeSlug string `json:"microsite_slug"`
}

type codeQuotaArgs struct {
	MaxMembers         fp.OptionalInt32 `json:"max_members"`
	MaxTurnsPerSession fp.OptionalInt32 `json:"max_turns_per_session"`
	CodeID             string           `json:"code_id"`
}

func updateCodeQuotas(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCodeQuotas(raw, ownerID)
		if perr != nil {
			return nil, perr
		}
		code, err := usecase.UpdateCodeQuotas(ctx, deps, in)
		if err != nil {
			return nil, codeErr(err)
		}
		extras.Write(ctx, in.CodeID, raw)
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

func decodeCodeQuotas(raw json.RawMessage, ownerID string) (*usecase.CodeQuotaUpdate, error) {
	var in codeQuotaArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
		return nil, err
	}
	return &usecase.CodeQuotaUpdate{
		OwnerID: ownerID, CodeID: in.CodeID,
		MaxMembers: usecase.OptionalQuota{
			Value: in.MaxMembers.Value, Set: in.MaxMembers.Set,
		},
		MaxTurnsPerSession: usecase.OptionalQuota{
			Value: in.MaxTurnsPerSession.Value, Set: in.MaxTurnsPerSession.Set,
		},
	}, nil
}

type codeGhostArgs struct {
	RequireGhostEvidence *bool  `json:"require_ghost_evidence"`
	CodeID               string `json:"code_id"`
}

func setCodeGhostEvidence(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeGhostArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
			return nil, err
		}
		code, err := deps.Codes.SetGhostEvidence(ctx, ownerID, in.CodeID, in.RequireGhostEvidence)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

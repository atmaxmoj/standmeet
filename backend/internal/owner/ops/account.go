// account.go —— the owner's own account: read me, rename, set timezone, change email,
// change password, generate a recovery phrase.
//
// The three ops carrying a **current password** or a **freshly generated secret** are a
// written-down single-face decision: panel-only. MCP is a pure JSON tool face and doesn't
// carry raw credentials.
//
// Before the migration, MCP's `me` was **hand-assembled string** JSON, only four fields,
// with no escaping — a quote in a name would produce invalid JSON. Now it shares the same
// shape and the same serializer as the panel's GET /me.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// AccountDeps —— the dependencies this group needs. Changing email / password needs the
// current password, generating a recovery phrase needs to send mail, so it spans both the
// account and recovery sets.
type AccountDeps struct {
	Account  usecase.AccountDeps
	Recovery usecase.RecoveryDeps
	// EmailChange —— changing email needs to ask "can we send mail?" (a mail connector
	// means a pending confirmation, none means an immediate swap), so it has one more
	// outbound port than Account.
	EmailChange usecase.EmailChangeDeps
}

// Account —— me / set_full_name / set_timezone / change_email / change_password /
// generate_recovery.
func Account(deps AccountDeps) []fp.Op {
	return append(accountReadOps(deps), accountCredentialOps(deps)...)
}

func accountReadOps(deps AccountDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "me",
			Description: "Return the authenticated StandMeet owner and their settings.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      readMe(deps.Account),
		},
		{
			ID:          "account.set_full_name",
			Description: "Change the owner's display name.",
			InputSchema: fullNameSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setFullName(deps.Account),
		},
		{
			ID: "account.set_timezone",
			Description: "Set the owner's IANA timezone (e.g. America/New_York). Capabilities " +
				"that reason about time of day — booking hours, for one — read it from here; " +
				"it is the owner's profile, not any one capability's setting.",
			InputSchema: timezoneSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setTimezone(deps.Account),
		},
	}
}

// accountCredentialOps —— the three carrying credentials: panel-only, reason spelled out
// in each entry's Reach.
func accountCredentialOps(deps AccountDeps) []fp.Op {
	credentialed := func(why string) fp.Reach { return fp.Only(why, "admin") }
	return []fp.Op{
		{
			ID: "account.change_email",
			Description: "Change the login email. Requires the current password; panel-only " +
				"because it carries a raw credential.",
			InputSchema: changeEmailSchema,
			Kind:        fp.Action,
			Reach: credentialed(
				"verifies + changes the login email (current-password gated)"),
			Invoke: changeEmail(deps.EmailChange),
		},
		{
			ID: "account.cancel_email_change",
			Description: "Drop a pending email change. The confirmation link in the message " +
				"that was already sent stops working.",
			InputSchema: noArgs,
			Kind:        fp.Action,
			Reach:       credentialed("touches the login identity"),
			Invoke:      cancelEmailChange(deps.EmailChange),
		},
		{
			ID: "account.change_password",
			Description: "Change the login password. Requires the current password; " +
				"panel-only because it carries raw credentials.",
			InputSchema: changePasswordSchema,
			Kind:        fp.Action,
			Reach:       credentialed("raw password; current-password gated"),
			Invoke:      changePassword(deps.Account),
		},
		{
			ID: "account.generate_recovery",
			Description: "Mint a new account-recovery phrase. Only its hash is stored; the " +
				"phrase itself is sent to the owner.",
			InputSchema: noArgs,
			Kind:        fp.Action,
			Reach:       credentialed("mints a recovery secret"),
			Invoke:      generateRecovery(deps.Recovery),
		},
	}
}

var (
	fullNameSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"full_name":{"type":"string","description":"New display name."}},
		"required":["full_name"]
	}`)

	timezoneSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"timezone":{"type":"string","description":"IANA tz name."}},
		"required":["timezone"]
	}`)

	changeEmailSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"current_password":{"type":"string"},
			"new_email":{"type":"string"}
		},
		"required":["current_password","new_email"]
	}`)

	changePasswordSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"current_password":{"type":"string"},
			"new_password":{"type":"string","description":"At least 12 characters."}
		},
		"required":["current_password","new_password"]
	}`)
)

// accountErr —— domain sentinels → protocol-agnostic categories. Owner not found / wrong
// password = this session's identity doesn't hold → Unauthed (the frontend redirects to
// login on it); code is an already-published contract.
func accountErr(err error) error {
	for _, c := range accountErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("account op", err)
}

var accountErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrOwnerNotFound, func() error {
		return fp.Coded(fp.Unauthed("owner not found"), "unauthorized")
	}},
	// In this op family, ErrUnauthorized has exactly one source: **the current
	// password field was wrong**. The owner is already in with a session; the one
	// credential he supplies at this step is that single field. So saying
	// "invalid credentials" swaps a message he can act on for one he has to guess
	// at — and CLAUDE.md requires errors to read like human language.
	// No enumeration risk here either: whoever reaches this step is already
	// logged in.
	{entity.ErrUnauthorized, func() error {
		return fp.Coded(fp.Unauthed("current password is incorrect"), "unauthorized")
	}},
	{entity.ErrEmailTaken, func() error {
		return fp.Coded(fp.Conflict("email already in use"), "email_taken")
	}},
	{usecase.ErrPasswordTooShort, func() error {
		return fp.BadInput("password must be at least 12 characters")
	}},
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("required field is empty")
	}},
}

// ownerFieldOut —— after a field is changed, reply with its new value (the panel has
// always used this shape).
type ownerFieldOut struct {
	FullName string `json:"full_name,omitempty"`
	Email    string `json:"email,omitempty"`
}

func setFullName(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			FullName string `json:"full_name"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		updated, err := usecase.UpdateOwnerFullName(ctx, deps, ownerID, in.FullName)
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(ownerFieldOut{FullName: updated.FullName})
	}
}

// setTimezone —— an empty string = UTC (the convention on the domain side).
func setTimezone(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Timezone string `json:"timezone"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := deps.Owners.UpdateProfileTimezone(ctx, ownerID, in.Timezone); err != nil {
			return nil, accountErr(err)
		}
		profile, gerr := deps.Owners.GetByID(ctx, ownerID)
		if gerr != nil {
			return nil, accountErr(gerr)
		}
		return json.Marshal(map[string]string{"timezone": profile.ProfileTimezone})
	}
}

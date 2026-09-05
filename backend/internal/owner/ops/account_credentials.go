// account_credentials.go —— reads me, and implements the three credentialed actions.
//
// me's payload = owner profile + their inference settings. The settings half reuses the
// **single** constructor in settings.go: before the migration there were two copies, so the
// same face was internally inconsistent (GET /me's ai had endpoint/model, the write's reply
// didn't, and the frontend swapping the response into its cache blanked both fields).

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// ownerOut / meOut —— outbound shape (same for both faces). No password, no credential of
// any kind.
type ownerOut struct {
	OwnerID   string `json:"owner_id"`
	Email     string `json:"email"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
	// Timezone —— IANA timezone name. It's the owner's profile, not any one capability's
	// setting.
	Timezone string `json:"timezone"`
	// PendingEmail —— a new email that's been requested but not yet confirmed. Empty =
	// no pending change.
	// **Must be sent**: an invisible pending state means the owner can't tell whether the
	// click they just made took effect.
	PendingEmail string `json:"pending_email,omitempty"`
}

type meOut struct {
	Owner    ownerOut    `json:"owner"`
	Settings settingsOut `json:"settings"`
}

func readMe(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		profile, err := deps.Owners.GetByID(ctx, ownerID)
		if err != nil {
			return nil, accountErr(err)
		}
		settings, serr := deps.Owners.GetSettings(ctx, ownerID)
		if serr != nil {
			return nil, accountErr(serr)
		}
		return json.Marshal(meOut{
			Owner: ownerOut{
				OwnerID: profile.ID, Email: profile.Email, Handle: profile.Handle,
				FullName: profile.FullName, PublicURL: profile.PublicURL,
				Timezone: profile.ProfileTimezone, PendingEmail: profile.PendingEmail,
			},
			Settings: settingsPayload(&settings),
		})
	}
}

// emailChangeOut —— the receipt must say **what happened**, not "succeeded".
// A non-empty pending = a confirmation email went out, identity untouched; empty = swapped
// immediately. The UI says two different things for those two cases, and a receipt that
// can't tell them apart lets the owner believe the change already landed (non-unique signal).
type emailChangeOut struct {
	Email   string `json:"email"`
	Pending string `json:"pending_email,omitempty"`
}

func changeEmail(deps usecase.EmailChangeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			CurrentPassword string `json:"current_password"`
			NewEmail        string `json:"new_email"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		out, err := usecase.RequestEmailChange(ctx, deps, &usecase.EmailChangeInput{
			OwnerID: ownerID, CurrentPassword: in.CurrentPassword, NewEmail: in.NewEmail,
		})
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(emailChangeOut{Email: out.Email, Pending: out.Pending})
	}
}

func cancelEmailChange(deps usecase.EmailChangeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		owner, err := usecase.CancelEmailChange(ctx, deps, ownerID)
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(emailChangeOut{Email: owner.Email})
	}
}

func changePassword(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		err := usecase.UpdateOwnerPassword(ctx, deps, &usecase.PasswordUpdateInput{
			OwnerID:         ownerID,
			CurrentPassword: in.CurrentPassword,
			NewPassword:     in.NewPassword,
		})
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

// generateRecovery —— a delivery failure is an **external dependency** problem (the mail
// connector isn't set up), and that message can go straight to the owner, not an internal
// error. Replying {"sent":true} says "it went out", not "it was stored".
func generateRecovery(deps usecase.RecoveryDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		if err := usecase.GenerateRecovery(ctx, &deps, ownerID); err != nil {
			// The name is relayed by the assembly root via Proxy: this message names
			// whatever the connector is called on the panel.
			return nil, fp.Coded(fp.Upstream(
				"couldn't send the recovery phrase — connect and verify a "+
					deps.Proxy.ChannelName()+" connector first",
			),
				"recovery_send_failed")
		}
		return json.Marshal(map[string]bool{"sent": true})
	}
}

// email_change.go — changing email: prove the new address can receive mail before
// letting it become the sign-in identity.
//
// **Why it can't switch instantly**: the `owners.email` column is both the **sign-in
// identity** and the **recovery channel** (recovery.go's `To:` reads it directly).
// Switching instantly would hand both the key and the spare key to an address that
// hasn't been proven to exist — one typo takes out both at once. And since the session
// is keyed by ownerID, the owner feels nothing at the moment of the switch; it only
// bites the day the session expires.
//
// **Two paths, chosen by outbound channel**:
//   - A verified mail connector exists -> go through pending: send a confirmation email,
//     switch only once it's clicked.
//   - None exists -> switch instantly. The feature can't be pulled just because mail
//     can't be sent (that would push the system's limitation onto the user as discipline),
//     so it degrades to the frontend's "type it twice" + spelling out the consequences in
//     full. Same pattern as the recovery-phrase row gating on SMTP being connected (#115).
//
// **The recovery phrase still goes to the old address while pending** — the new address
// hasn't been proven yet, and handing the lifeline channel to it would just relocate the
// hole. This isn't visible in this file (recovery.go reads the Email column, which is
// naturally correct already), but it's a precondition this design depends on, and it's
// pinned down by a test.

package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

const (
	// emailTokenBytes — 128-bit random. This is exactly the string in the link; unguessable.
	emailTokenBytes = 16
	// emailConfirmWindow — how long the confirmation link stays valid. Enough for the
	// owner to switch devices to check mail, but not so long that a six-month-old email
	// could still switch the identity.
	emailConfirmWindow = 24 * time.Hour
	// confirmPath — the path of the link inside the email. The frontend has a page waiting
	// here (app/confirm-email).
	confirmPath = "/confirm-email?token="
)

// ErrPendingEmailExpired — the token is recognized, but expired. Kept separate from
// "not recognized" because what the owner does next depends on the distinction:
// expired -> click save again; invalid -> this email isn't for you.
var ErrPendingEmailExpired = errors.New("email confirmation link expired")

// EmailChangeDeps — dependencies for changing email. Proxy is used to ask "can mail be
// sent at all" and to actually send the confirmation email.
type EmailChangeDeps struct {
	Owners *repo.Repo
	Proxy  OutboundSender
}

// EmailChangeInput — a request to change email.
type EmailChangeInput struct {
	OwnerID         string
	CurrentPassword string
	NewEmail        string
}

// EmailChangeOutput — the receipt must spell out **what happened**, not just "success".
// Pending non-empty = a confirmation email was sent, identity unchanged; empty = switched
// instantly. The UI shows two different messages depending on which.
type EmailChangeOutput struct {
	Email   string
	Pending string
}

// RequestEmailChange — verify password -> validate email -> decide pending vs. instant
// switch based on the outbound channel.
func RequestEmailChange(
	ctx context.Context, deps EmailChangeDeps, in *EmailChangeInput,
) (EmailChangeOutput, error) {
	if verr := verifyCurrentPassword(ctx, AccountDeps{Owners: deps.Owners},
		in.OwnerID, in.CurrentPassword); verr != nil {
		return EmailChangeOutput{}, verr
	}
	normalized, nerr := normalizeEmail(in.NewEmail)
	if nerr != nil {
		return EmailChangeOutput{}, nerr
	}
	if !canConfirmByMail(ctx, deps, in.OwnerID) {
		return switchEmailNow(ctx, deps, in.OwnerID, normalized)
	}
	return startPendingEmailChange(ctx, deps, in.OwnerID, normalized)
}

// canConfirmByMail — can this instance send a confirmation email right now. If the
// check itself fails, treat that as **cannot send**: proceeding as if it can would show
// the owner "confirmation email sent" for an email that was never sent, and he'd wait
// forever for a message that never arrives.
func canConfirmByMail(ctx context.Context, deps EmailChangeDeps, ownerID string) bool {
	connected, err := deps.Proxy.Connected(ctx, ownerID)
	return err == nil && connected
}

// switchEmailNow — the path taken when there's no outbound channel: switch instantly.
// The feature can't be pulled just because mail can't be sent (that would push the
// system's limitation onto the user as discipline); the safety net degrades to the
// frontend's double-entry + spelling out the consequences in full.
func switchEmailNow(
	ctx context.Context, deps EmailChangeDeps, ownerID, normalized string,
) (EmailChangeOutput, error) {
	updated, err := deps.Owners.UpdateEmail(ctx, ownerID, normalized)
	if err != nil {
		return EmailChangeOutput{}, fmt.Errorf("update email: %w", err)
	}
	return EmailChangeOutput{Email: updated.Email}, nil
}

// startPendingEmailChange — records the pending confirmation + sends the confirmation
// link to the **new** address. Sending it to the new address is the entire point:
// receiving it is what proves the address is real.
func startPendingEmailChange(
	ctx context.Context, deps EmailChangeDeps, ownerID, newEmail string,
) (EmailChangeOutput, error) {
	token, terr := newEmailToken()
	if terr != nil {
		return EmailChangeOutput{}, terr
	}
	owner, oerr := deps.Owners.SetPendingEmail(
		ctx, ownerID, newEmail, hashEmailToken(token), time.Now().Add(emailConfirmWindow),
	)
	if oerr != nil {
		return EmailChangeOutput{}, fmt.Errorf("record pending email: %w", oerr)
	}
	if serr := deps.Proxy.Send(ctx, ownerID, OutboundNotice{
		To:    newEmail,
		Title: "Confirm your new StandMeet email",
		Body:  confirmNoticeBody(owner.PublicURL, token),
	}); serr != nil {
		return EmailChangeOutput{}, fmt.Errorf("send email confirmation: %w", serr)
	}
	return EmailChangeOutput{Email: owner.Email, Pending: newEmail}, nil
}

// ConfirmEmailChange — the link is clicked. On a match, switch identity and invalidate
// this token (one-time use).
func ConfirmEmailChange(
	ctx context.Context, deps EmailChangeDeps, token string,
) (entity.Owner, error) {
	// An empty token never queries the DB: it has the same answer as "this email was
	// fabricated", and we already know that here. Don't give it a dedicated error either —
	// that would tell a probing attacker how close they are to the right shape.
	if token == "" {
		return entity.Owner{}, entity.ErrPendingEmailNotFound
	}
	hash := hashEmailToken(token)
	owner, err := deps.Owners.ConfirmPendingEmail(ctx, hash)
	if err == nil {
		return owner, nil
	}
	if !errors.Is(err, entity.ErrPendingEmailNotFound) {
		return entity.Owner{}, fmt.Errorf("confirm pending email: %w", err)
	}
	return entity.Owner{}, classifyConfirmMiss(ctx, deps, hash)
}

// classifyConfirmMiss — the switch didn't happen; was it expired or just never recognized.
// Only distinguishes these for someone whose token **actually exists**; a nonexistent
// token always says "not recognized", never telling a guesser whether they guessed right.
func classifyConfirmMiss(ctx context.Context, deps EmailChangeDeps, hash string) error {
	found, ferr := deps.Owners.FindByPendingToken(ctx, hash)
	if ferr != nil {
		return entity.ErrPendingEmailNotFound
	}
	if time.Now().After(found.ExpiresAt) {
		return ErrPendingEmailExpired
	}
	return entity.ErrPendingEmailNotFound
}

// CancelEmailChange — the owner changed their mind. Once cleared, the link in that
// email is dead too (its hash is gone).
func CancelEmailChange(
	ctx context.Context, deps EmailChangeDeps, ownerID string,
) (entity.Owner, error) {
	owner, err := deps.Owners.ClearPendingEmail(ctx, ownerID)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("cancel pending email: %w", err)
	}
	return owner, nil
}

func newEmailToken() (string, error) {
	b := make([]byte, emailTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate email token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// hashEmailToken — sha256, not bcrypt. This token is a **unique lookup key** (an exact
// WHERE match), so it must be deterministic; and it's already 128-bit random, so it
// doesn't need a slow hash to defend against dictionary attacks.
func hashEmailToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func confirmNoticeBody(publicURL, token string) string {
	link := strings.TrimSuffix(publicURL, "/") + confirmPath + token
	return strings.Join([]string{
		"Someone (probably you) asked to change the email on your StandMeet instance.",
		"",
		"Open this link to confirm — until you do, your sign-in and your recovery",
		"phrase both stay on the old address:",
		"",
		link,
		"",
		"The link works once and expires in 24 hours. If this wasn't you, ignore",
		"this message and nothing changes.",
	}, "\n")
}

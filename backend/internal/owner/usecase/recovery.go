// recovery.go — #100 account recovery phrase.
//
// GenerateRecovery (authed): generates a high-entropy phrase -> stores only the hash
// (bcrypt, reusing the password hasher) -> the plaintext is sent **only** to the
// owner's email (through the owner's own mail connector; SMTP credentials never leave
// the vault).
// Recover (public): when locked out, {email, phrase} is checked against the hash; on a
// match -> invalidate (single use) -> issue an owner session. The public endpoint's
// brute-force surface is rate-limited by the route layer's login-guard; this layer only
// does "verify correctness -> exchange for a session".

package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

const (
	// recoveryPhraseBytes — 128-bit random, about 26 chars after base32, infeasible to brute-force.
	recoveryPhraseBytes = 16
	// phraseGroupLen — readable grouping: one hyphenated segment per 4 chars (k7m2-9xqp-...).
	phraseGroupLen = 4
)

// RecoveryDeps — recovery dependencies. Owners = read/write recovery_hash + creds;
// Sessions = issues a session after recovery; Proxy = delivers the phrase.
type RecoveryDeps struct {
	Owners   *repo.Repo
	Sessions *session.OwnerSessionStore
	Proxy    OutboundSender
}

// RecoverInput — input to the public /recover endpoint.
type RecoverInput struct {
	Email  string
	Phrase string
}

// RecoverOutput — the session on successful recovery (consistent with Login; the route
// sets the cookie).
type RecoverOutput struct {
	SessionToken string
	CSRFToken    string
	OwnerID      string
	OwnerHandle  string
}

// GenerateRecovery — generates a phrase, stores its hash, emails the plaintext to the
// owner. Requires a working outbound channel (otherwise Send errors).
func GenerateRecovery(ctx context.Context, deps *RecoveryDeps, ownerID string) error {
	ownerRow, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("recovery owner lookup: %w", err)
	}
	phrase, serr := storeNewRecovery(ctx, deps, ownerID)
	if serr != nil {
		return serr
	}
	if merr := deps.Proxy.Send(ctx, ownerID, OutboundNotice{
		To:    ownerRow.Email,
		Title: "Your StandMeet recovery phrase",
		Body:  recoveryNoticeBody(phrase),
	}); merr != nil {
		return fmt.Errorf("send recovery phrase: %w", merr)
	}
	return nil
}

// storeNewRecovery — generates the phrase + hashes it + stores it, returns the
// plaintext phrase (for the notice body).
func storeNewRecovery(ctx context.Context, deps *RecoveryDeps, ownerID string) (string, error) {
	phrase, perr := newRecoveryPhrase()
	if perr != nil {
		return "", perr
	}
	hash, herr := session.HashPassword(phrase)
	if herr != nil {
		return "", fmt.Errorf("hash recovery phrase: %w", herr)
	}
	if serr := deps.Owners.SetRecoveryHash(ctx, ownerID, hash); serr != nil {
		return "", fmt.Errorf("store recovery hash: %w", serr)
	}
	return phrase, nil
}

// Recover — {email, phrase} matches recovery_hash -> invalidate (single use) -> issue
// a session. Anything wrong -> ErrUnauthorized (not distinguishing "no such email" /
// "never generated" / "wrong phrase", to defend against enumeration).
func Recover(ctx context.Context, deps *RecoveryDeps, in *RecoverInput) (RecoverOutput, error) {
	if in.Email == "" || in.Phrase == "" {
		return RecoverOutput{}, apierr.ErrEmptyField
	}
	creds, verr := verifyRecovery(ctx, deps, in)
	if verr != nil {
		return RecoverOutput{}, verr
	}
	return issueRecovered(ctx, deps, &creds)
}

// verifyRecovery — checks email + phrase against recovery_hash. Any failure returns
// ErrUnauthorized uniformly (defends against enumeration).
func verifyRecovery(
	ctx context.Context, deps *RecoveryDeps, in *RecoverInput,
) (repo.Credentials, error) {
	creds, err := deps.Owners.GetCredentialsByEmail(ctx, in.Email)
	if err != nil {
		return repo.Credentials{}, entity.ErrUnauthorized
	}
	if creds.RecoveryHash == "" {
		return repo.Credentials{}, entity.ErrUnauthorized
	}
	if vperr := session.VerifyPassword(in.Phrase, creds.RecoveryHash); vperr != nil {
		return repo.Credentials{}, entity.ErrUnauthorized
	}
	return creds, nil
}

// issueRecovered — single use: invalidate recovery_hash first, then issue the session
// (even under concurrency, only one attempt can succeed).
func issueRecovered(
	ctx context.Context, deps *RecoveryDeps, creds *repo.Credentials,
) (RecoverOutput, error) {
	if cerr := deps.Owners.ClearRecoveryHash(ctx, creds.OwnerID); cerr != nil {
		return RecoverOutput{}, fmt.Errorf("clear recovery: %w", cerr)
	}
	// Recovery is a rare emergency path; the IP/UA aren't threaded here, so this
	// session shows as an unknown device in the panel until its next use.
	issued, ierr := deps.Sessions.Issue(ctx, creds.OwnerID, "", "")
	if ierr != nil {
		return RecoverOutput{}, fmt.Errorf("issue recovered session: %w", ierr)
	}
	return RecoverOutput{
		SessionToken: issued.Token, CSRFToken: issued.Data.CSRFToken,
		OwnerID: creds.OwnerID, OwnerHandle: creds.Handle,
	}, nil
}

// newRecoveryPhrase — 128-bit random -> lowercase base32 -> hyphenated in groups of 4
// chars (readable, e.g. k7m2-9xqp-...).
func newRecoveryPhrase() (string, error) {
	b := make([]byte, recoveryPhraseBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("recovery rand: %w", err)
	}
	raw := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	groups := make([]string, 0, len(raw)/phraseGroupLen+1)
	for i := 0; i < len(raw); i += phraseGroupLen {
		end := min(i+phraseGroupLen, len(raw))
		groups = append(groups, raw[i:end])
	}
	return strings.Join(groups, "-"), nil
}

func recoveryNoticeBody(phrase string) string {
	return strings.Join([]string{
		"Someone (hopefully you) generated an account recovery phrase for your StandMeet instance.",
		"",
		"phrase: " + phrase,
		"",
		"Keep it safe. If you're ever locked out, enter your email + this phrase on the recovery " +
			"page to sign back in. It works once.",
	}, "\n")
}

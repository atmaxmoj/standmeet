// credential_only.go — a credential-only supplier: the owner stores a credential (a bot token,
// a webhook secret) and the supplier does nothing itself. It has no seam contract. Some other
// service consumes it out of band (the `im` case: the separate `im-bridge` reads the token from
// `GET /internal/im/config` and runs the bot). The host names no specific protocol here: this is
// selected by the manifest declaring `kind: credential`, so a token-only block needs no host code.
//
// A credential block may declare where its token is accepted (`transport: url` + `headers`, with
// `{token}` in place of the token). Connect then asks that address first, and a token the service
// refuses is refused on the owner's card — not discovered later in a container log (sijie,
// 2026-10-01: a card said "connected" over a token Discord refused, and the bridge crash-looped).
//
// This generalizes what used to be a per-protocol `NewTelegramSupplier` reached by a
// `switch m.Protocol { case "telegram" }` — the host naming a block, which everything-is-a-block
// forbids (host stays blind to blocks; a built-in is just a plugin someone wrote early).

package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// CredentialVault — where a credential-only supplier reads its connection state and, for its
// check, the stored credential. The credentials repo satisfies it.
type CredentialVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
	Credentials(ctx context.Context, blockID, ownerID string) (json.RawMessage, error)
}

// CredentialCheck — the address a credential block declares its token is accepted at. Empty URL =
// no check: saving the credential is the whole act.
type CredentialCheck struct {
	Headers map[string]string
	URL     string
	Title   string // the block's own name, for the owner-facing sentence
}

// credentialOnlySupplier — implements the Supplier base surface.
type credentialOnlySupplier struct {
	vault CredentialVault
	id    string
}

// checkedCredentialSupplier — a credential-only supplier with a declared check: also a Verifier.
type checkedCredentialSupplier struct {
	*credentialOnlySupplier

	doer  *http.Client
	check CredentialCheck
}

// NewCredentialOnlySupplier — assemble a credential-only supplier (a token holder, no client code).
func NewCredentialOnlySupplier(
	id string, vault CredentialVault, check CredentialCheck, doer *http.Client,
) Supplier {
	base := &credentialOnlySupplier{vault: vault, id: id}
	if check.URL == "" {
		return base
	}
	return &checkedCredentialSupplier{credentialOnlySupplier: base, doer: doer, check: check}
}

// Name — Supplier base surface.
func (c *credentialOnlySupplier) Name() string { return c.id }

// Kind — a credential-only supplier reports kind=credential.
func (*credentialOnlySupplier) Kind() string { return "credential" }

// Connected — whether the owner has stored the credential and connected; delegates to the vault.
func (c *credentialOnlySupplier) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("supplier %q connected: %w", c.id, err)
	}
	return ok, nil
}

// checkTimeout — how long Connect waits for the service to answer about the token.
const checkTimeout = 10 * time.Second

// Verify — ask the declared address whether it accepts the stored token. 2xx passes; anything
// else is the owner-facing refusal.
func (c *checkedCredentialSupplier) Verify(ctx context.Context, ownerID string) error {
	token, err := c.token(ctx, ownerID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	req, err := c.request(ctx, strings.NewReplacer("{token}", token))
	if err != nil {
		return err
	}
	res, err := c.doer.Do(req)
	if err != nil {
		return refused("could not reach " + c.check.Title + " to check this token — try again")
	}
	return c.judge(res)
}

// judge — 2xx: the service accepts the token; anything else is the owner-facing refusal.
func (c *checkedCredentialSupplier) judge(res *http.Response) error {
	if cerr := res.Body.Close(); cerr != nil {
		return fmt.Errorf("credential check: %w", cerr)
	}
	if res.StatusCode/100 != 2 {
		return refused(c.check.Title + " did not accept this token — copy it again, then connect")
	}
	return nil
}

// request — the declared check, with the token filled into its url and headers.
func (c *checkedCredentialSupplier) request(
	ctx context.Context, fill *strings.Replacer,
) (*http.Request, error) {
	url := fill.Replace(c.check.URL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("credential check request: %w", err)
	}
	for k, v := range c.check.Headers {
		req.Header.Set(k, fill.Replace(v))
	}
	return req, nil
}

// token — the stored token, trimmed (a pasted token often carries a stray space or newline).
func (c *checkedCredentialSupplier) token(ctx context.Context, ownerID string) (string, error) {
	raw, err := c.vault.Credentials(ctx, c.id, ownerID)
	if err != nil {
		return "", fmt.Errorf("supplier %q credentials: %w", c.id, err)
	}
	var cred struct {
		Token string `json:"token"`
	}
	if len(raw) > 0 {
		if uerr := json.Unmarshal(raw, &cred); uerr != nil {
			return "", fmt.Errorf("supplier %q credentials: %w", c.id, uerr)
		}
	}
	return strings.TrimSpace(cred.Token), nil
}

// refusedError — the owner-facing reason a check failed. Carries a fault code, so the card
// shows the sentence verbatim (blockadmin.verifyReason).
type refusedError struct{ msg string }

func refused(msg string) error { return &refusedError{msg: msg} }

func (e *refusedError) Error() string { return e.msg }

// FaultCode — marks the sentence as meant for the owner.
func (*refusedError) FaultCode() string { return "credential_refused" }

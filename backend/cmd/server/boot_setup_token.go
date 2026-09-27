// boot_setup_token.go —— the setup token an unclaimed instance hands out, self-healed through the
// /api/v1/instance handler. (Issued once at boot by ensureSetupToken in main.go.)

package main

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/infra/session"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// setupTokenIssuerAdapter —— wraps *owner.InstanceRepo + *session.SetupTokenHolder
// into an owner.SetupTokenIssuer, letting the /api/v1/instance handler self-heal an
// unclaimed setup token through the usecase without importing session directly.
type setupTokenIssuerAdapter struct {
	log    *slog.Logger
	repo   *owner.InstanceRepo
	holder *session.SetupTokenHolder
	// issuing —— issuance must be singleflight: writing the DB hash and the in-memory
	// holder are two steps, and letting two requests interleave once leaves an
	// unusable "holder=TA, DB=hash(TB)" combo (F-L-56, hit for real: homepage SSR
	// calls /api/v1/instance on every render, so concurrency here is the norm).
	// Locking the whole check-then-issue section removes the interleaving window.
	issuing sync.Mutex
}

// UsableToken —— does the DB hash match this in-memory plaintext? Returns the
// plaintext if so, else empty (caller re-issues). Checking "both non-empty" isn't
// enough — that's exactly what the broken state looks like too.
func (a *setupTokenIssuerAdapter) UsableToken(ctx context.Context) (string, error) {
	a.issuing.Lock()
	defer a.issuing.Unlock()
	return a.usableLocked(ctx)
}

// IssueAndStore —— singleflight. Rechecks on entry: of the requests that were
// waiting on the lock, the first already issued a token, so the rest reuse it
// instead of each issuing their own (wasted work, and the last would overwrite it).
func (a *setupTokenIssuerAdapter) IssueAndStore(ctx context.Context) (string, error) {
	a.issuing.Lock()
	defer a.issuing.Unlock()
	if usable, err := a.usableLocked(ctx); err == nil && usable != "" {
		return usable, nil
	}
	if err := session.IssueSetupToken(ctx, a.log, a.repo, a.holder); err != nil {
		return "", fmt.Errorf("issue setup token: %w", err)
	}
	return a.holder.Plaintext(), nil
}

// usableLocked —— shared by the two methods above: does the DB hash match this
// in-memory plaintext? Caller already holds the lock.
func (a *setupTokenIssuerAdapter) usableLocked(ctx context.Context) (string, error) {
	inst, err := a.repo.Get(ctx)
	if err != nil {
		return "", fmt.Errorf("get instance settings: %w", err)
	}
	plaintext := a.holder.Plaintext()
	if inst.SetupTokenHash == "" || plaintext == "" {
		return "", nil
	}
	if session.HashSetupToken(plaintext) != inst.SetupTokenHash {
		// The only explanation for "why did the link that went out suddenly change".
		a.log.Warn("setup token halves diverged; re-issuing",
			"reason", "in-memory plaintext does not hash to the stored hash")
		return "", nil
	}
	return plaintext, nil
}

// codes_expiry.go —— an access code's expiry, enforced. The door refuses a code past its expiry
// (repo.GetByCode). A live session has no moment to hook, so its end is driven: at once when the
// owner sets a past expiry, and by the "code expiry" run when the date simply passes — the same
// way a revocation ends sessions (DeleteByCode), with no extra read on each turn.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// codeExpiryEvery —— how late a passed expiry may end a live session.
// ponytail: a 5-minute sweep; a per-turn check if that slack ever matters.
const codeExpiryEvery = 5 * time.Minute

// SetCodeExpiry —— codes.set_expiry: move or clear (nil = never) a code's expiry. A code now
// past it loses its live sessions at once. Returns the code as stored.
func SetCodeExpiry(
	ctx context.Context, d CodesDeps, ownerID, codeID string, at *time.Time,
) (entity.Code, error) {
	if err := d.Codes.SetExpiry(ctx, ownerID, codeID, at); err != nil {
		return entity.Code{}, err
	}
	code, err := d.Codes.GetByID(ctx, codeID)
	if err != nil {
		return entity.Code{}, fmt.Errorf("read code back: %w", err)
	}
	if code.Expired {
		if serr := d.Sessions.DeleteByCode(ctx, codeID); serr != nil {
			return entity.Code{}, fmt.Errorf("end expired code sessions: %w", serr)
		}
	}
	return code, nil
}

// CodeExpiryPeriodicJobs —— the run that ends the live sessions of codes whose expiry passed.
func CodeExpiryPeriodicJobs(d CodesDeps) []periodic.Job {
	return []periodic.Job{periodic.Named("code expiry", codeExpiryEvery,
		func(ctx context.Context) error { return endExpiredSessions(ctx, d) })}
}

// endExpiredSessions —— idempotent: a code whose sessions are already gone costs one Redis read.
func endExpiredSessions(ctx context.Context, d CodesDeps) error {
	ids, err := d.Codes.ExpiredActiveIDs(ctx)
	if err != nil {
		return err
	}
	errs := make([]error, 0, len(ids))
	for _, id := range ids {
		errs = append(errs, d.Sessions.DeleteByCode(ctx, id))
	}
	return errors.Join(errs...)
}

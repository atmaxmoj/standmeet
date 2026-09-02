// invoke_background.go — background (fire-and-forget) connector calls + retry on transient
// errors.
//
// Why this is needed: some calls' **results shouldn't block the caller**. The notification
// email sent to the owner after a booking is confirmed is the typical case — the booking is
// already in the DB, the calendar event is already created, the visitor is staring at the card
// waiting for a response; blocking the tool call on a notification email (and waiting through
// its retry backoff too) has things backwards.
//
// Why this must live in the host rather than the capability spawning its own goroutine: a
// sandboxed capability's process lifetime is **only this one turn** — it may be reclaimed the
// moment the tool call returns, and a retry goroutine started inside it would disappear along
// with the process, not surviving even the first backoff. So "work that still needs to continue
// after this turn ends" can only be held by the host.
//
// The retry base is only allowed for use by the connector layer per the architecture, so the
// backoff policy stays here (reusing notifyPolicy) instead of scattering into routes/cmd.

package connector

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

// backgroundBudget — total time budget for a background call. Slightly wider than notifyPolicy's
// MaxTotal, leaving room for the last attempt to finish running; it gives up on timeout (doesn't
// hang indefinitely holding resources).
const backgroundBudget = 3 * time.Minute

// SetLogger — where a background call's failure goes. Not set → silent (only test wiring does
// this).
// The logger is injected once alongside Slots, not passed on every call: that would blow up the
// parameter list, and the thin routes shell isn't allowed to import connector per the
// architecture, so it can't share an input struct.
func (s *Slots) SetLogger(log *slog.Logger) { s.log = log }

// InvokeBackground — returns immediately, the call runs in the background, transient transport
// errors retry with notifyPolicy backoff.
//
// Using ctx just to cancel "being queued" is meaningless: the caller (the sandbox) leaves
// right away, and its ctx gets canceled immediately after. So this deliberately uses
// context.WithoutCancel to cut off the parent cancellation, keeping only its own budget —
// otherwise the background task would get canceled the instant it's born (and silently, too).
func (s *Slots) InvokeBackground(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) {
	detached, cancel := context.WithTimeout(context.WithoutCancel(ctx), backgroundBudget)
	go func() {
		defer cancel()
		err := retry.Do(detached, notifyPolicy(), func() error {
			_, ierr := s.Invoke(detached, ownerID, category, verb, args)
			return ierr
		})
		if err != nil && s.log != nil {
			// Nobody is waiting on a background failure — if it doesn't get logged loudly,
			// it's as if it never happened.
			s.log.Error("connector background invoke failed",
				"category", category, "verb", verb, "owner", ownerID, "err", err)
		}
	}()
}

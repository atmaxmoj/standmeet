package periodic

import (
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

// CronDue —— whether a job with owner-set schedule `expr`, last run at `since`, is due by `now`:
// a scheduled tick fell in (since, now]. Empty expr = no schedule, never due. Standard 5-field
// cron plus @daily/@hourly/@weekly, evaluated in UTC so a boundary means the same thing regardless
// of the server's timezone. Shared by every owner-scheduled job (gas refill, conversation prune).
func CronDue(expr string, since, now time.Time) (bool, error) {
	if expr == "" {
		return false, nil
	}
	sched, err := cron.ParseStandard(expr)
	if err != nil {
		return false, fmt.Errorf("parse cron: %w", err)
	}
	return !sched.Next(since.UTC()).After(now.UTC()), nil
}

// ValidCron —— reject a malformed schedule at the write boundary, so a bad expression is never
// stored to be re-parsed (and skipped) on every checker tick. Empty = no schedule, valid.
func ValidCron(expr string) error {
	if expr == "" {
		return nil
	}
	if _, err := cron.ParseStandard(expr); err != nil {
		return fmt.Errorf("parse cron: %w", err)
	}
	return nil
}

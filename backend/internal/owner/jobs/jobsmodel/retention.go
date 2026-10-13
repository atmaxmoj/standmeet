// retention.go —— an assessment's lifecycle (docs/design/job-loop-retention.md): forever unless
// the owner's AI says ephemeral; an ephemeral one lives on a bundle's clock — 90 days from its last
// touch, the last 7 shown as expiring, stopped while pinned — and clears to a tombstone.

package jobsmodel

import (
	"errors"
	"time"
)

// Retention classes.
const (
	RetentionForever   = "forever"
	RetentionEphemeral = "ephemeral"
)

const (
	retentionTTL   = 90 * 24 * time.Hour
	expiringWithin = 7 * 24 * time.Hour
)

// Retention errors the caller can act on.
var (
	ErrBadRetention      = errors.New("retention must be forever or ephemeral")
	ErrAssessmentCleared = errors.New("this assessment was cleared by retention; " +
		"restore it with retention.restore (bundle_id) first")
	ErrNoSuchBundle   = errors.New("no live retention bundle of yours has that bundle_id")
	ErrKeepNeedsClock = errors.New("keep pins an ephemeral assessment; this one is forever")
)

// Clock —— the bundle an ephemeral row lives on.
type Clock struct {
	LastTouchedAt time.Time
	BundleID      string
	Keep          bool
}

// RetentionChange —— jobs.annotate's lifecycle arguments (none = leave it).
type RetentionChange struct {
	Keep      *bool
	Retention string
	BundleID  string
}

// Check —— the arguments make sense on their own.
func (c *RetentionChange) Check() error {
	switch c.Retention {
	case "", RetentionForever, RetentionEphemeral:
	default:
		return ErrBadRetention
	}
	if c.BundleID != "" && c.Retention != RetentionEphemeral {
		return ErrBadRetention
	}
	return nil
}

// RetentionWire —— the lifecycle as jobs.history shows it.
type RetentionWire struct {
	BundleID      *string `json:"bundle_id"`
	LastTouchedAt *string `json:"last_touched_at"`
	ExpiresAt     *string `json:"expires_at"`
	ClearedAt     *string `json:"cleared_at"`
	Retention     string  `json:"retention"`
	Keep          bool    `json:"keep"`
	Expiring      bool    `json:"expiring"`
}

// RetentionWireOf —— forever rows carry no clock; a pinned or cleared row has no expiry.
func RetentionWireOf(c *Clock, cleared *time.Time, now time.Time) *RetentionWire {
	w := &RetentionWire{Retention: RetentionForever}
	if cleared != nil {
		w.ClearedAt = stamp(*cleared)
	}
	if c == nil {
		return w
	}
	w.Retention, w.BundleID, w.Keep = RetentionEphemeral, &c.BundleID, c.Keep
	w.LastTouchedAt = stamp(c.LastTouchedAt)
	if c.Keep || cleared != nil {
		return w
	}
	expires := c.LastTouchedAt.Add(retentionTTL)
	w.ExpiresAt, w.Expiring = stamp(expires), expires.Sub(now) <= expiringWithin
	return w
}

func stamp(t time.Time) *string {
	s := t.UTC().Format(time.RFC3339Nano)
	return &s
}

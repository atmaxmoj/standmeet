// Package ban — internal implementation of IP banning in the security domain (entity + repo).
// Accessed externally only through the security facade.
package ban

import "time"

// BannedIP — a source IP the owner has banned. A matching IP gets a 403 on the
// public /api/v1 surface. ExpiresAt nil = permanent ban; non-nil = auto-expires
// at that time (the enforcement query filters with now()). Reason is the
// owner's own note.
type BannedIP struct {
	ExpiresAt *time.Time
	CreatedAt time.Time
	ID        string
	OwnerID   string
	IP        string
	Reason    string
}

// Active — whether this ban is in effect right now (permanent, or not yet expired).
func (b *BannedIP) Active(now time.Time) bool {
	return b.ExpiresAt == nil || b.ExpiresAt.After(now)
}

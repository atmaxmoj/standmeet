// access_request.go — a message left by a visitor without a code on /<handle>/gate.
// owner reviews it at /admin/requests; open -> replied (after emailing back) / closed (ignored).
// No auto-notify to owner, no auto-reply email — owner-curated is a deliberate product choice.

package entity

import (
	"errors"
	"time"
)

// Request — one visitor message. Field order follows govet fieldalignment:
// time.Time first (internal ptr at offset 16), strings right after.
type Request struct {
	CreatedAt time.Time
	ID        string
	OwnerID   string
	Name      string
	Org       string
	Email     string
	Message   string
	Status    string // 'open' | 'replied' | 'closed'
}

// CreateAccessRequestInput — the usecase's input for creating one message.
type CreateAccessRequestInput struct {
	OwnerID string
	Name    string
	Org     string
	Email   string
	Message string
}

// ErrAccessRequestNotFound — UpdateStatus's id does not exist or does not belong to this owner.
var ErrAccessRequestNotFound = errors.New("access request not found")

// ErrAccessRequestStatusInvalid — UpdateStatus's status argument is not a valid value.
var ErrAccessRequestStatusInvalid = errors.New("access request status invalid")

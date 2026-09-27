// access_request.go — a message left by a visitor without a code on /<handle>/gate.
// owner reviews it at /admin/requests; open -> replied (after emailing back) / closed (ignored).
// The owner is mailed a notice (capped against floods); the requester hears back only when the
// owner approves — owner-curated is a deliberate product choice.

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
	// NoticeJobID —— the approval notice's job (0 = none yet). Its state is the request's
	// delivery state.
	NoticeJobID int64
}

// AccessRequestCreated —— the event a submitted request records, in the same transaction as the
// row. Subject access_request/<id>; data {request_id}.
const AccessRequestCreated = "access_request.created"

// NotifySlot —— what the owner-notification job may do for one request.
type NotifySlot int

// The slots.
const (
	NotifyDropped NotifySlot = iota // over the owner's cap: no mail (the request stays in admin)
	NotifySend                      // a slot is held: send
	NotifySent                      // already sent: nothing to do
)

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

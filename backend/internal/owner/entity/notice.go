// notice.go —— the owner domain's notice jobs: their kinds, their thin args, and the three words a
// face shows for one (docs/design/event-bus-outbox-webhooks.md, *Completion hooks*). The kernel
// says "notice"; which channel carries it is decided outside the kernel.

package entity

// Notice job kinds and the subscription that notifies the owner.
const (
	// OwnerNotify —— the subscription on access_request.created and booking.created that
	// notifies the owner.
	OwnerNotify = "owner.notify"
	// ApprovalNoticeKind —— delivers an approved requester their code, then marks the request
	// replied.
	ApprovalNoticeKind = "access_request.approval_mail"
	// EmailConfirmKind —— delivers the confirmation link of a pending email change.
	EmailConfirmKind = "owner.email_confirmation"
)

// Notice states a face shows: the notice job's state in three words.
const (
	NoticeSending = "sending" // queued, running, or waiting for its next attempt
	NoticeSent    = "sent"    // the job completed: the provider accepted it
	NoticeFailed  = "failed"  // discarded or cancelled: it will not go out unless retried by hand
)

// ApprovalNoticeArgs —— the approval notice job's args. Ids only: the job reads the rest when it
// runs.
type ApprovalNoticeArgs struct {
	OwnerID   string `json:"owner_id"`
	RequestID string `json:"request_id"`
	CodeID    string `json:"code_id"`
}

// EmailConfirmArgs —— the confirmation job's args. The link's token is minted when the job sends,
// so no secret sits in the job row.
type EmailConfirmArgs struct {
	OwnerID string `json:"owner_id"`
	Email   string `json:"email"`
}

// NoticeReceipt —— what a face shows for one notice: its state and the job to follow.
type NoticeReceipt struct {
	State string `json:"state"`
	JobID int64  `json:"job_id"`
}

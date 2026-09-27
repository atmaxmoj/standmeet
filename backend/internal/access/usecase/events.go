// events.go —— the event types this domain owns (docs/design/event-bus-outbox-webhooks.md,
// *Webhook event types*). Thin: the subject names the row, the data carries ids and small scalar
// facts. Each is recorded by the use case that makes the fact, in the fact's own transaction.

package usecase

import (
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

// Event types. access_request.created lives in entity (the owner's mail subscriber reads it).
const (
	AccessRequestApproved      = "access_request.approved"
	AccessRequestStatusChanged = "access_request.status_changed"
	CodeIssued                 = "code.issued"
	CodeRevoked                = "code.revoked"
	CodeRedeemed               = "code.redeemed"
	APIKeyIssued               = "api_key.issued" //nolint:gosec // an event type name, no secret
	APIKeyRevoked              = "api_key.revoked"
)

// EventTypes —— the event types this domain owns.
func EventTypes() []events.Type {
	t := func(typ, desc, subject string) events.Type {
		return events.Type{Type: typ, Description: desc, Subject: subject, Exposure: events.Webhook}
	}
	req, code, key := "access_request/<request id>", "code/<code id>", "api_key/<key id>"
	return []events.Type{
		t(entity.AccessRequestCreated,
			"A visitor submitted an access request (data.request_id).", req),
		t(AccessRequestApproved,
			"The owner approved an access request and issued it a code "+
				"(data.request_id, data.code_id).", req),
		t(AccessRequestStatusChanged,
			"The owner set an access request's status (data.request_id, data.status).", req),
		t(CodeIssued, "An access code was issued (data.code_id).", code),
		t(CodeRevoked, "An access code was revoked (data.code_id).", code),
		t(CodeRedeemed,
			"A new visitor joined through an access code (data.code_id, data.member_id).", code),
		t(APIKeyIssued, "An API key was issued (data.key_id).", key),
		t(APIKeyRevoked, "An API key was revoked (data.key_id).", key),
	}
}

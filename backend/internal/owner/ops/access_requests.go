// access_requests.go —— the access_requests resource: /gate access requests visitors
// submit, which the owner views / changes status on / approves here.
//
// This resource spans two domains: the request data itself lives in access, while approve's
// full loop (issue a code, send the code + link to the requester, mark the request replied)
// lives in owner — it needs the owner's public address and the owner's configured outbound
// channel. The declaration follows **the half that does the work**, so it lives here; list
// and status-update just delegate to access.
//
// An unconfigured outbound channel is **the caller's problem** (the owner has to go set it
// up), so it goes through BadInput, and every face passes that message through verbatim.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// AccessRequestsDeps —— the read/update half lives in access, the approve half in this
// domain.
type AccessRequestsDeps struct {
	Requests access.RequestsDeps
	Approve  usecase.ApproveRequestDeps
}

// AccessRequests —— list / update / approve。
func AccessRequests(d *AccessRequestsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "access_requests.list",
			Description: "List /gate access requests, newest first, one page at a time " +
				"({items, next_cursor, total}). Optional status filter " +
				"(open / replied / closed); empty returns all.",
			InputSchema: paging.Schema(accessRequestListSchema),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listAccessRequests(d.Requests, d.Approve.Jobs),
		},
		{
			ID:          "access_requests.update",
			Description: "Update a gate access request's status (open / replied / closed).",
			InputSchema: accessRequestUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateAccessRequest(d.Requests, d.Approve.Jobs),
		},
		{
			ID: "access_requests.approve",
			Description: "Approve a gate access request: issue an access code (returned at " +
				"once with its link) and mail it to the requester. The request turns replied " +
				"only after the mail went out; mail.state says sending, sent or failed, and " +
				"access_requests.list shows it later. A supplier able to deliver it must be " +
				"set up first.",
			InputSchema: accessRequestIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      approveAccessRequest(d.Approve),
		},
	}
}

var (
	accessRequestListSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"status":{"type":"string",
				"description":"Optional filter: open, replied, or closed."},
			"id":{"type":"string","description":"Optional: only this request."}
		}
	}`)

	accessRequestUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Access request id."},
			"status":{"type":"string",
				"description":"New status: open, replied, or closed."}
		},
		"required":["id","status"]
	}`)

	accessRequestIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Access request id."}},
		"required":["id"]
	}`)
)

// accessRequestOut —— outbound payload shape (same for every face). Mail —— the approval
// mail's receipt (sending / sent / failed); absent before approval.
type accessRequestOut struct {
	Mail      *entity.NoticeReceipt `json:"mail,omitempty"`
	CreatedAt string                `json:"created_at"`
	ID        string                `json:"id"`
	Name      string                `json:"name"`
	Org       string                `json:"org"`
	Email     string                `json:"email"`
	Message   string                `json:"message"`
	Status    string                `json:"status"`
}

func toAccessRequestOut(
	ctx context.Context, j usecase.MailJobs, a *access.Request,
) accessRequestOut {
	return accessRequestOut{
		ID: a.ID, Name: a.Name, Org: a.Org, Email: a.Email,
		Message: a.Message, Status: a.Status,
		CreatedAt: a.CreatedAt.Format(time.RFC3339),
		Mail:      usecase.MailReceiptOf(ctx, j, a.NoticeJobID),
	}
}

func listAccessRequests(deps access.RequestsDeps, j usecase.MailJobs) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := paging.ParseArgs[access.RequestFilter](raw)
		if perr != nil {
			return nil, fp.BadInput("invalid arguments: " + perr.Error())
		}
		page, err := access.ListForOwner(ctx, deps, ownerID, in.Filter, in.Req)
		if err != nil {
			return nil, accessRequestErr(err)
		}
		return json.Marshal(paging.Each(page, func(a *access.Request) accessRequestOut {
			return toAccessRequestOut(ctx, j, a)
		}))
	}
}

type accessRequestUpdateArgs struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func updateAccessRequest(deps access.RequestsDeps, j usecase.MailJobs) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in accessRequestUpdateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs(
			[2]string{"id", in.ID}, [2]string{"status", in.Status},
		); err != nil {
			return nil, err
		}
		row, err := access.UpdateAccessRequestStatus(ctx, deps, ownerID, in.ID, in.Status)
		if err != nil {
			return nil, accessRequestErr(err)
		}
		return json.Marshal(toAccessRequestOut(ctx, j, &row))
	}
}

type accessRequestIDArgs struct {
	ID string `json:"id"`
}

// approvedOut —— the product of approval: the issued code, the link the visitor can click,
// and the mail's receipt (it may still be sending).
type approvedOut struct {
	Code string               `json:"code"`
	Link string               `json:"link"`
	Mail entity.NoticeReceipt `json:"mail"`
}

func approveAccessRequest(deps usecase.ApproveRequestDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in accessRequestIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		out, err := usecase.ApproveAccessRequest(ctx, deps, ownerID, in.ID)
		if err != nil {
			// When delivery fails, say clearly **what** to go connect — the name is
			// relayed by the assembly root via Proxy; this layer doesn't know whether
			// it's mail or something else.
			return nil, approveErr(err, deps.Proxy.ChannelName())
		}
		return json.Marshal(approvedOut{Code: out.Code, Link: out.Link, Mail: out.Mail})
	}
}

// accessRequestErr —— domain error vocabulary → protocol-agnostic category. An unconfigured
// outbound channel is also the caller's problem: the owner has to go set it up, it isn't
// this machine being broken.
func accessRequestErr(err error) error {
	for _, c := range accessRequestErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("access request op", err)
}

var accessRequestErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{access.ErrAccessRequestNotFound, func() error {
		return fp.NotFound("request not found")
	}},
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("missing required field")
	}},
	{access.ErrAccessRequestStatusInvalid, func() error {
		return fp.BadInput("invalid status value (want open, replied, or closed)")
	}},
	{paging.ErrBadCursor, func() error { return fp.BadInput("bad cursor") }},
}

// approveErr —— the class unique to approve: delivery failure. The message must name what
// the owner **finds on the suppliers page**; "an outbound channel" is a term that doesn't
// exist in the UI, and he can't find anything by looking for it.
func approveErr(err error, channel string) error {
	if errors.Is(err, usecase.ErrOutboundNotConfigured) {
		return fp.BadInput("connect and verify a " + channel + " supplier first")
	}
	return accessRequestErr(err)
}

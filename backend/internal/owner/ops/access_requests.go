// access_requests.go —— 资源 access_requests:/gate 上访客递交的准入申请,owner 在这儿
// 看 / 改状态 / 批准。
//
// 这个资源横跨两个域:申请这份数据在 access,而 approve 的闭环(发一张码、把码 + 链接发给
// 申请人、把申请置 replied)在 owner —— 它要 owner 的公开地址,也要 owner 配好的出站通道。
// 声明跟着**做事的那一半**走,所以住在这里;读和改状态直接转交 access。
//
// 出站通道没配好是**调用方的问题**(owner 得先去配),所以走 BadInput,每个面都把这句话
// 原样给出来。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// AccessRequestsDeps —— 读改那一半在 access,批准那一半在本域。
type AccessRequestsDeps struct {
	Requests access.RequestsDeps
	Approve  usecase.ApproveRequestDeps
}

// AccessRequests —— list / update / approve。
func AccessRequests(d AccessRequestsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "access_requests.list",
			Description: "List /gate access requests. Optional status filter " +
				"(open / replied / closed); empty returns all.",
			InputSchema: accessRequestListSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listAccessRequests(d.Requests),
		},
		{
			ID:          "access_requests.update",
			Description: "Update a gate access request's status (open / replied / closed).",
			InputSchema: accessRequestUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateAccessRequest(d.Requests),
		},
		{
			ID: "access_requests.approve",
			Description: "Approve a gate access request: issue an access code, email " +
				"it (code + link) to the requester, and mark the request replied. " +
				"The mail connector must be connected first.",
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
				"description":"Optional filter: open, replied, or closed."}
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

// accessRequestOut —— 出站载荷形状(每个面同一份)。
type accessRequestOut struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Org       string `json:"org"`
	Email     string `json:"email"`
	Message   string `json:"message"`
	Status    string `json:"status"`
}

func toAccessRequestOut(a *access.Request) accessRequestOut {
	return accessRequestOut{
		ID: a.ID, Name: a.Name, Org: a.Org, Email: a.Email,
		Message: a.Message, Status: a.Status,
		CreatedAt: a.CreatedAt.Format(time.RFC3339),
	}
}

type accessRequestListArgs struct {
	Status string `json:"status"`
}

// decodeStatusFilter —— 参数可选:空 body = 不筛。
func decodeStatusFilter(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var in accessRequestListArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.Status, nil
}

func listAccessRequests(deps access.RequestsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		status, perr := decodeStatusFilter(raw)
		if perr != nil {
			return nil, perr
		}
		rows, err := access.ListForOwner(ctx, deps, ownerID, status)
		if err != nil {
			return nil, accessRequestErr(err)
		}
		out := make([]accessRequestOut, 0, len(rows))
		for i := range rows {
			out = append(out, toAccessRequestOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

type accessRequestUpdateArgs struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func updateAccessRequest(deps access.RequestsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in accessRequestUpdateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs(
			[2]string{"id", in.ID}, [2]string{"status", in.Status}); err != nil {
			return nil, err
		}
		row, err := access.UpdateAccessRequestStatus(ctx, deps, ownerID, in.ID, in.Status)
		if err != nil {
			return nil, accessRequestErr(err)
		}
		return json.Marshal(toAccessRequestOut(&row))
	}
}

type accessRequestIDArgs struct {
	ID string `json:"id"`
}

// approvedOut —— 批准的产物:发出去的码,和访客可点的链接。
type approvedOut struct {
	Code string `json:"code"`
	Link string `json:"link"`
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
			return nil, accessRequestErr(err)
		}
		return json.Marshal(approvedOut{Code: out.Code, Link: out.Link})
	}
}

// accessRequestErr —— 域的错误词汇 → 协议无关的类别。出站通道没配好也是调用方的问题:
// owner 得先去配,不是这台机器坏了。
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
	{consumer.ErrMailNotConfigured, func() error {
		return fp.BadInput("configure and test your mail connector first")
	}},
}

// res_access_requests.go —— 资源 access_requests:/gate 上访客递交的准入申请,owner 在这儿
// 看 / 改状态 / 批准。
//
// approve 是个闭环动作:发一个 access code、把 code + 链接邮件给申请人、把申请置 replied。
// 它需要邮件连接器已经配好 —— 没配好是**调用方的问题**(owner 得先去配),所以走 BadInput,
// 两个面都会把这句话原样给出来。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// AccessRequestStore —— access_requests 这组操作所需的最小口。
type AccessRequestStore interface {
	List(ctx context.Context, ownerID, status string) ([]AccessRequest, error)
	UpdateStatus(ctx context.Context, ownerID, id, status string) (AccessRequest, error)
	Approve(ctx context.Context, ownerID, id string) (AccessApproval, error)
}

// AccessRequest —— 一条准入申请在收口这一层的形状。
type AccessRequest struct {
	CreatedAt time.Time
	ID        string
	Name      string
	Org       string
	Email     string
	Message   string
	Status    string
}

// AccessApproval —— 批准的产物:发出去的 code 和访客可点的链接。
type AccessApproval struct {
	Code string
	Link string
}

// AccessRequests —— access_requests 资源:list / update / approve。
func AccessRequests(store AccessRequestStore) Resource {
	return Resource{Name: "access_requests", Ops: []Op{
		{
			ID: "access_requests.list",
			Description: "List /gate access requests. Optional status filter " +
				"(open / replied / closed); empty returns all.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"status":{"type":"string",
						"description":"Optional filter: open, replied, or closed."}
				}
			}`),
			Kind:   fp.Read,
			Reach:  fp.OwnerRead(),
			Invoke: accessRequestsList(store),
		},
		{
			ID:          "access_requests.update",
			Description: "Update a gate access request's status (open / replied / closed).",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{
					"id":{"type":"string","description":"Access request id."},
					"status":{"type":"string",
						"description":"New status: open, replied, or closed."}
				},
				"required":["id","status"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: accessRequestsUpdate(store),
		},
		{
			ID: "access_requests.approve",
			Description: "Approve a gate access request: issue an access code, email " +
				"it (code + link) to the requester, and mark the request replied. " +
				"The mail connector must be connected first.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"id":{"type":"string","description":"Access request id."}},
				"required":["id"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: accessRequestsApprove(store),
		},
	}}
}

// accessRequestRow —— 出站载荷形状(两个面同一份)。
type accessRequestRow struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Org       string `json:"org"`
	Email     string `json:"email"`
	Message   string `json:"message"`
	Status    string `json:"status"`
}

func toAccessRequestRow(a *AccessRequest) accessRequestRow {
	return accessRequestRow{
		ID: a.ID, Name: a.Name, Org: a.Org, Email: a.Email,
		Message: a.Message, Status: a.Status,
		CreatedAt: a.CreatedAt.Format(time.RFC3339),
	}
}

type accessRequestListArgs struct {
	Status string `json:"status"`
}

func accessRequestsList(store AccessRequestStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in accessRequestListArgs
		if err := decodeOptional(raw, &in); err != nil {
			return nil, err
		}
		rows, err := store.List(ctx, ownerID, in.Status)
		if err != nil {
			return nil, fmt.Errorf("list access requests: %w", err)
		}
		return marshalOut(toAccessRequestRows(rows))
	}
}

func toAccessRequestRows(rows []AccessRequest) []accessRequestRow {
	out := make([]accessRequestRow, 0, len(rows))
	for i := range rows {
		out = append(out, toAccessRequestRow(&rows[i]))
	}
	return out
}

type accessRequestUpdateArgs struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func parseAccessRequestUpdate(raw json.RawMessage) (accessRequestUpdateArgs, error) {
	var in accessRequestUpdateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.ID == "" {
		return in, BadInput("id is required")
	}
	if in.Status == "" {
		return in, BadInput("status is required")
	}
	return in, nil
}

func accessRequestsUpdate(store AccessRequestStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseAccessRequestUpdate(raw)
		if perr != nil {
			return nil, perr
		}
		out, err := store.UpdateStatus(ctx, ownerID, in.ID, in.Status)
		if err != nil {
			return nil, fmt.Errorf("update access request: %w", err)
		}
		row := toAccessRequestRow(&out)
		return marshalOut(row)
	}
}

type accessRequestIDArgs struct {
	ID string `json:"id"`
}

func accessRequestsApprove(store AccessRequestStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in accessRequestIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.ID == "" {
			return nil, BadInput("id is required")
		}
		out, err := store.Approve(ctx, ownerID, in.ID)
		if err != nil {
			return nil, fmt.Errorf("approve access request: %w", err)
		}
		return marshalOut(map[string]string{"code": out.Code, "link": out.Link})
	}
}

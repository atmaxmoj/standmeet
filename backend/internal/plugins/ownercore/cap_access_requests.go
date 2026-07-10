package ownercore

// cap_access_requests.go —— owner-side /gate access-request review Capability.
// 3 tools: access_requests.list / access_requests.update / access_requests.approve.
// owner-only. Mirrors the admin /access-requests route over MCP.

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capAccessRequestsBundle = "access_requests.bundle"

// AccessRequestsOwnerDeps —— newAccessRequestsCapability 入参打包。list/update 走
// Reqs (usecases.AccessRequestsDeps)；approve 闭环 (issue code + mail) 走 Approve
// (usecases.ApproveRequestDeps)。
type AccessRequestsOwnerDeps struct {
	Reqs    usecases.AccessRequestsDeps
	Approve usecases.ApproveRequestDeps
}

type accessRequestsCapability struct {
	deps *AccessRequestsOwnerDeps
	log  *slog.Logger
}

func newAccessRequestsCapability(
	deps *AccessRequestsOwnerDeps, log *slog.Logger,
) *accessRequestsCapability {
	return &accessRequestsCapability{deps: deps, log: log}
}

func (*accessRequestsCapability) ID() string          { return capAccessRequestsBundle }
func (*accessRequestsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*accessRequestsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*accessRequestsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*accessRequestsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *accessRequestsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listBinding(), c.updateBinding(), c.approveBinding(),
	}
}

// accessRequestRow —— MCP wire view of a gate request.
type accessRequestRow struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Org       string `json:"org"`
	Email     string `json:"email"`
	Message   string `json:"message"`
	Status    string `json:"status"`
}

func toAccessRequestRow(a *domain.AccessRequest) accessRequestRow {
	return accessRequestRow{
		ID: a.ID, Name: a.Name, Org: a.Org, Email: a.Email,
		Message: a.Message, Status: a.Status,
		CreatedAt: a.CreatedAt.Format(mcpTimeFmt),
	}
}

// ───── access_requests.list ─────────────────────────────────────

func (c *accessRequestsCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "access_requests.list",
		Description: "List /gate access requests. Optional status filter " +
			"(open / replied / closed); empty returns all.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"status":{"type":"string",
					"description":"Optional filter: open, replied, or closed."}
			}
		}`),
		Handler: c.handleList,
	}
}

type accessRequestListArgsWire struct {
	Status string `json:"status"`
}

func (c *accessRequestsCapability) handleList(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args accessRequestListArgsWire
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return capreg.MCPError("invalid arguments: " + err.Error())
		}
	}
	rows, err := usecases.ListForOwner(ctx, c.deps.Reqs, ownerID, args.Status)
	if err != nil {
		return c.errToResult("access_requests.list", err)
	}
	out := make([]accessRequestRow, 0, len(rows))
	for i := range rows {
		out = append(out, toAccessRequestRow(&rows[i]))
	}
	return mcputil.MarshalResult(c.log, "access_requests.list", out)
}

// ───── access_requests.update ───────────────────────────────────

func (c *accessRequestsCapability) updateBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "access_requests.update",
		Description: "Update a gate access request's status " +
			"(open / replied / closed).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Access request id."},
				"status":{"type":"string",
					"description":"New status: open, replied, or closed."}
			},
			"required":["id","status"]
		}`),
		Handler: c.handleUpdate,
	}
}

type accessRequestUpdateArgsWire struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func parseAccessRequestUpdateArgs(raw json.RawMessage) (accessRequestUpdateArgsWire, error) {
	var args accessRequestUpdateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.ID == "" {
		return args, errors.New("id is required")
	}
	if args.Status == "" {
		return args, errors.New("status is required")
	}
	return args, nil
}

func (c *accessRequestsCapability) handleUpdate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseAccessRequestUpdateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	out, err := usecases.UpdateAccessRequestStatus(
		ctx, c.deps.Reqs, ownerID, args.ID, args.Status,
	)
	if err != nil {
		return c.errToResult("access_requests.update", err)
	}
	return mcputil.MarshalResult(c.log, "access_requests.update", toAccessRequestRow(&out))
}

// ───── access_requests.approve ──────────────────────────────────

func (c *accessRequestsCapability) approveBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "access_requests.approve",
		Description: "Approve a gate access request: issue an access code, email " +
			"it (code + link) to the requester, and mark the request replied. " +
			"The mail connector must be connected first.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Access request id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleApprove,
	}
}

type accessRequestApproveArgsWire struct {
	ID string `json:"id"`
}

func (c *accessRequestsCapability) handleApprove(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args accessRequestApproveArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.ID == "" {
		return capreg.MCPError("id is required")
	}
	out, err := usecases.ApproveAccessRequest(ctx, c.deps.Approve, ownerID, args.ID)
	if err != nil {
		return c.approveErrToResult(err)
	}
	return mcputil.MarshalResult(c.log, "access_requests.approve", map[string]string{
		"code": out.Code, "link": out.Link,
	})
}

// ───── error mapping ────────────────────────────────────────────

func (c *accessRequestsCapability) errToResult(tool string, err error) capreg.MCPResult {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		return capreg.MCPError("missing required field")
	case errors.Is(err, domain.ErrAccessRequestStatusInvalid):
		return capreg.MCPError("invalid status value (want open, replied, or closed)")
	case errors.Is(err, domain.ErrAccessRequestNotFound):
		return capreg.MCPError("access request not found")
	default:
		c.log.Error("cap "+tool, "err", err)
		return capreg.MCPError(tool + " failed")
	}
}

func (c *accessRequestsCapability) approveErrToResult(err error) capreg.MCPResult {
	switch {
	case errors.Is(err, usecases.ErrMailNotConfigured):
		return capreg.MCPError("configure and test your mail connector first")
	case errors.Is(err, domain.ErrAccessRequestNotFound):
		return capreg.MCPError("access request not found")
	default:
		c.log.Error("cap access_requests.approve", "err", err)
		return capreg.MCPError("access_requests.approve failed")
	}
}

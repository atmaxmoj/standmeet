// wire_disp_codes.go —— access 域的邀请码 → 出站收口的窄口(核心面;ACL 面在
// wire_disp_codes_acl.go)。
//
// max_bookings 值得单说:它是 **booker 自管的 per-code 配额**,不是码本身的字段
// (内核的 access_code 表里没有它)。所以这里读写它要经 booker 的隔离存储 ——
// 组装根把两处拼成 owner 眼里的"一张码",收口只看见一个资源。
//
// 这个拼接是**已知的欠账**:真正对的做法是 per-code 的能力配置(现在的 capconfig 是
// per-owner 的),那是一个还没定的设计。在那之前如实拼在这儿,而不是假装 max_bookings
// 是码的字段。

package main

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type codeOps struct {
	deps    access.CodesDeps
	codes   *access.CodeRepo
	denials *access.CodeDenialRepo
	quota   bookerQuotaStore
	roles   *access.RoleRepo
}

func newCodeOps(d *runtimeDeps) codeOps {
	return codeOps{
		deps: access.CodesDeps{
			Codes: d.codeRepo, Roles: d.roleRepo, Sessions: d.visitorStore,
		},
		codes: d.codeRepo, denials: d.codeDenialRepo,
		quota: newBookerQuotaStore(d), roles: d.roleRepo,
	}
}

func (a codeOps) List(ctx context.Context, ownerID string) ([]dispatcher.Code, error) {
	rows, err := a.codes.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, codeErr(err)
	}
	out := make([]dispatcher.Code, 0, len(rows))
	for i := range rows {
		out = append(out, a.toDispatcherCode(ctx, &rows[i]))
	}
	return out, nil
}

func (a codeOps) Create(
	ctx context.Context, in *dispatcher.CreateCode,
) (dispatcher.Code, error) {
	code, err := access.IssueCode(ctx, a.deps, &access.CreateCodeInput{
		OwnerID: in.OwnerID, Code: in.Code, Label: in.Label, Purpose: in.Purpose,
		Ghosts: in.Ghosts, AssumedRoleID: in.AssumedRoleID, PromptID: in.PromptID,
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession, ExpiresAt: in.ExpiresAt,
	})
	if err != nil {
		return dispatcher.Code{}, codeErr(err)
	}
	a.writeQuota(ctx, code.ID, in.MaxBookings)
	return a.toDispatcherCode(ctx, &code), nil
}

func (a codeOps) Revoke(ctx context.Context, ownerID, codeID string) error {
	return codeErr(access.RevokeCode(ctx, a.deps, ownerID, codeID))
}

func (a codeOps) UpdateQuotas(
	ctx context.Context, in *dispatcher.UpdateCodeQuotas,
) (dispatcher.Code, error) {
	code, err := access.UpdateCodeQuotas(ctx, a.deps, &access.CodeQuotaUpdate{
		OwnerID: in.OwnerID, CodeID: in.CodeID,
		MaxTurnsPerSession: quotaOf(in.MaxTurnsPerSession),
		MaxMembers:         quotaOf(in.MaxMembers),
	})
	if err != nil {
		return dispatcher.Code{}, codeErr(err)
	}
	if in.MaxBookings.Set {
		a.writeQuota(ctx, in.CodeID, in.MaxBookings.Value)
	}
	return a.toDispatcherCode(ctx, &code), nil
}

// quotaOf —— 收口的三态入参 → 域的三态入参。两边是同一个概念的两种表达:
// 线上("字段出没出现")和域里("要不要动这个配额")。
func quotaOf(o dispatcher.OptionalInt32) access.OptionalQuota {
	return access.OptionalQuota{Value: o.Value, Set: o.Set}
}

func (a codeOps) SetGhostEvidence(
	ctx context.Context, ownerID, codeID string, require *bool,
) (dispatcher.Code, error) {
	code, err := a.codes.SetGhostEvidence(ctx, ownerID, codeID, require)
	if err != nil {
		return dispatcher.Code{}, codeErr(err)
	}
	return a.toDispatcherCode(ctx, &code), nil
}

func (a codeOps) Members(
	ctx context.Context, _, codeID string,
) ([]dispatcher.CodeMember, error) {
	rows, err := a.codes.ListMembers(ctx, codeID)
	if err != nil {
		return nil, codeErr(err)
	}
	out := make([]dispatcher.CodeMember, 0, len(rows))
	for i := range rows {
		out = append(out, dispatcher.CodeMember{
			ID: rows[i].ID, DisplayName: rows[i].DisplayName,
			Email: rows[i].Email, IsAnonymous: rows[i].IsAnonymous,
			LastSeenAt: &rows[i].LastSeenAt,
		})
	}
	return out, nil
}

// toDispatcherCode —— 域实体 + booker 的配额 → 收口形状。
func (a codeOps) toDispatcherCode(ctx context.Context, c *access.Code) dispatcher.Code {
	return dispatcher.Code{
		ID: c.ID, Code: c.Code, Label: c.Label, Status: c.Status,
		AssumedRoleID: c.AssumedRoleID, Ghosts: c.Ghosts,
		MaxMembers: c.MaxMembers, MaxTurnsPerSession: c.MaxTurnsPerSession,
		MaxBookings:          a.readQuota(ctx, c.ID),
		RequireGhostEvidence: c.RequireGhostEvidence,
		PromptID:             c.PromptID,
		CreatedAt:            c.CreatedAt, ExpiresAt: c.ExpiresAt,
	}
}

// readQuota / writeQuota —— booker 的 per-code 预约配额。读写都是 best-effort:
// 它是另一个能力的数据,取不到不该让整张码打不开,写不进也不该挡住发码。
func (a codeOps) readQuota(ctx context.Context, codeID string) *int32 {
	maxBookings, err := a.quota.MaxBookingsOf(ctx, codeID)
	if err != nil {
		return nil
	}
	return maxBookings
}

func (a codeOps) writeQuota(ctx context.Context, codeID string, maxBookings *int32) {
	if maxBookings == nil {
		return
	}
	if err := a.quota.SetMaxBookings(ctx, codeID, maxBookings); err != nil {
		// 另一个能力的存储写不进,不该挡住发码本身:码已经建好了,配额可以再设。
		_ = err
	}
}

func codeErr(err error) error {
	if err == nil {
		return nil
	}
	if classed := classifyCodeErr(err); classed != nil {
		return classed
	}
	return fmt.Errorf("code op: %w", err)
}

func classifyCodeErr(err error) error {
	for _, c := range codeErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return nil
}

var codeErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return dispatcher.BadInput("code and assumed_role_id are required")
	}},
	{access.ErrCodeInvalid, func() error {
		return dispatcher.Coded(dispatcher.NotFound("code not found"), "code_not_found")
	}},
	{access.ErrCodeTaken, func() error {
		return dispatcher.Coded(dispatcher.Conflict("code already exists"), "code_taken")
	}},
}

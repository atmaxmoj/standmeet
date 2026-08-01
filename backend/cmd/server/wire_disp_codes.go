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
	"log/slog"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type codeOps struct {
	codes    *access.CodeRepo
	denials  *access.CodeDenialRepo
	quota    bookerQuotaStore
	roles    *access.RoleRepo
	sessions *access.VisitorSessionStore
	log      *slog.Logger
}

func newCodeOps(d *runtimeDeps) codeOps {
	return codeOps{
		codes: d.codeRepo, denials: d.codeDenialRepo,
		quota: newBookerQuotaStore(d), roles: d.roleRepo,
		sessions: d.visitorStore, log: d.log,
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
	roleID, rerr := a.resolveRoleID(ctx, in.OwnerID, in.AssumedRoleID)
	if rerr != nil {
		return dispatcher.Code{}, rerr
	}
	code, err := a.codes.Create(ctx, &access.CreateCodeInput{
		OwnerID: in.OwnerID, Code: in.Code, Label: in.Label, Purpose: in.Purpose,
		Ghosts: in.Ghosts, AssumedRoleID: roleID, PromptID: in.PromptID,
		MaxMembers:         in.MaxMembers,
		MaxTurnsPerSession: in.MaxTurnsPerSession, ExpiresAt: in.ExpiresAt,
	})
	if err != nil {
		return dispatcher.Code{}, codeErr(err)
	}
	a.writeQuota(ctx, code.ID, in.MaxBookings)
	return a.toDispatcherCode(ctx, &code), nil
}

// Revoke —— 撤码,并清掉这张码已经发出去的 visitor session。
//
// 清 session 是撤销的另一半:不清,持码人手里的 token 还活着,要等到下一 turn 的
// per-turn 检查才被挡。清失败只记一笔 —— 那一层仍然会挡住,只是 cookie 暂时不清。
func (a codeOps) Revoke(ctx context.Context, ownerID, codeID string) error {
	if err := a.codes.Revoke(ctx, ownerID, codeID); err != nil {
		return codeErr(err)
	}
	if derr := a.sessions.DeleteByCode(ctx, codeID); derr != nil {
		a.log.Error("revoke: purge visitor sessions", "err", derr, "code_id", codeID)
	}
	return nil
}

// UpdateQuotas —— 底下那条 SQL 是**盲写**(SET 两列),所以没提到的字段要先读回当前值
// 填上,否则会被悄悄清成"不限"。
func (a codeOps) UpdateQuotas(
	ctx context.Context, in *dispatcher.UpdateCodeQuotas,
) (dispatcher.Code, error) {
	q, merr := a.mergeQuotas(ctx, in)
	if merr != nil {
		return dispatcher.Code{}, merr
	}
	code, err := a.codes.UpdateQuotas(ctx, in.OwnerID, in.CodeID, q.turns, q.members)
	if err != nil {
		return dispatcher.Code{}, codeErr(err)
	}
	if in.MaxBookings.Set {
		a.writeQuota(ctx, in.CodeID, in.MaxBookings.Value)
	}
	return a.toDispatcherCode(ctx, &code), nil
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

// quotaPair —— 写进那条盲写 SQL 的两个值。
type quotaPair struct {
	turns   *int32
	members *int32
}

// mergeQuotas —— 两个字段都提到了就不用读;否则读当前行补上没提到的那个。
func (a codeOps) mergeQuotas(
	ctx context.Context, in *dispatcher.UpdateCodeQuotas,
) (quotaPair, error) {
	if in.MaxTurnsPerSession.Set && in.MaxMembers.Set {
		return quotaPair{turns: in.MaxTurnsPerSession.Value, members: in.MaxMembers.Value}, nil
	}
	cur, gerr := a.codes.GetByID(ctx, in.CodeID)
	if gerr != nil {
		return quotaPair{}, codeErr(gerr)
	}
	if cur.OwnerID != in.OwnerID {
		return quotaPair{}, codeErr(access.ErrCodeInvalid)
	}
	return quotaPair{
		turns:   in.MaxTurnsPerSession.Or(cur.MaxTurnsPerSession),
		members: in.MaxMembers.Or(cur.MaxMembers),
	}, nil
}

// resolveRoleID —— 没显式指定 role 时兜到 owner 的 public role(claim 那一刻种下的)。
// 这条兜底以前只长在面板那条路由上:同一件事,MCP 那边必须显式给 role_id,
// 于是 owner 在两个面上"发一张最普通的码"要打不一样的字。
func (a codeOps) resolveRoleID(ctx context.Context, ownerID, requested string) (string, error) {
	if requested != "" {
		return requested, nil
	}
	public, err := a.roles.GetByName(ctx, ownerID, access.PublicRoleName)
	if err != nil {
		return "", codeErr(err)
	}
	return public.ID(), nil
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

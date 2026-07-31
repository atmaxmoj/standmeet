// wire_disp_access_requests.go —— access + owner 的普通函数 → 出站收口的窄口(准入申请)。

package main

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// accessRequestOps —— access/owner 的普通函数 → 收口要的窄口。
//
// 这个资源横跨两个域:list/update 在 access,approve 的闭环(发码 + 发信 + 置 replied)
// 在 owner。跨域的编排落在组装根 —— 收口只看见一个资源。
func newAccessRequestOps(d *runtimeDeps) accessRequestOps {
	return accessRequestOps{
		reqs: access.RequestsDeps{
			Repo: d.accessRequestRepo, Owners: soleOwnerLookup{owners: d.ownerRepo},
		},
		approve: owner.ApproveRequestDeps{
			Reqs: d.accessRequestRepo, Codes: d.codeRepo, Roles: d.roleRepo,
			Owners: d.ownerRepo, Proxy: outboundSender(d),
		},
	}
}

type accessRequestOps struct {
	reqs    access.RequestsDeps
	approve owner.ApproveRequestDeps
}

func (a accessRequestOps) List(
	ctx context.Context, ownerID, status string,
) ([]dispatcher.AccessRequest, error) {
	rows, err := access.ListForOwner(ctx, a.reqs, ownerID, status)
	if err != nil {
		return nil, accessRequestErr(err)
	}
	out := make([]dispatcher.AccessRequest, 0, len(rows))
	for i := range rows {
		out = append(out, toDispatcherAccessRequest(&rows[i]))
	}
	return out, nil
}

func (a accessRequestOps) UpdateStatus(
	ctx context.Context, ownerID, id, status string,
) (dispatcher.AccessRequest, error) {
	row, err := access.UpdateAccessRequestStatus(ctx, a.reqs, ownerID, id, status)
	if err != nil {
		return dispatcher.AccessRequest{}, accessRequestErr(err)
	}
	return toDispatcherAccessRequest(&row), nil
}

func (a accessRequestOps) Approve(
	ctx context.Context, ownerID, id string,
) (dispatcher.AccessApproval, error) {
	out, err := owner.ApproveAccessRequest(ctx, a.approve, ownerID, id)
	if err != nil {
		return dispatcher.AccessApproval{}, accessRequestErr(err)
	}
	return dispatcher.AccessApproval{Code: out.Code, Link: out.Link}, nil
}

func toDispatcherAccessRequest(a *access.Request) dispatcher.AccessRequest {
	return dispatcher.AccessRequest{
		ID: a.ID, Name: a.Name, Org: a.Org, Email: a.Email,
		Message: a.Message, Status: a.Status, CreatedAt: a.CreatedAt,
	}
}

// accessRequestErr —— 域的错误词汇 → 收口的三类。邮件连接器没配好也是**调用方的问题**:
// owner 得先去配,不是这台机器坏了。
func accessRequestErr(err error) error {
	if errors.Is(err, access.ErrAccessRequestNotFound) {
		//nolint:wrapcheck // 类别错误要原样上抛:包一层面就认不出是 404 还是 500
		return dispatcher.NotFound("request not found")
	}
	if msg, ok := accessRequestBadInput(err); ok {
		//nolint:wrapcheck // 同上
		return dispatcher.BadInput(msg)
	}
	return fmt.Errorf("access request op: %w", err)
}

// accessRequestBadInput —— 哪些域错误其实是"调用方(owner)得先去做点什么"。
// 邮件连接器没配好也算:那是 owner 的待办,不是这台机器坏了。
func accessRequestBadInput(err error) (string, bool) {
	switch {
	case errors.Is(err, apierr.ErrEmptyField):
		return "missing required field", true
	case errors.Is(err, access.ErrAccessRequestStatusInvalid):
		return "invalid status value (want open, replied, or closed)", true
	case errors.Is(err, consumer.ErrMailNotConfigured):
		return "configure and test your mail connector first", true
	default:
		return "", false
	}
}

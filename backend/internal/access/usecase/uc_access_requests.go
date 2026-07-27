// access_requests.go —— /gate 留言的创建 + admin 审阅。
//
// 业务逻辑薄：sole owner lookup + 必填字段校验。状态机由 domain 层和
// DB CHECK 共同把守，usecase 只做"白名单"判断。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// RequestsDeps —— SubmitForOwner / ListForOwner / UpdateStatus 共享依赖。
type RequestsDeps struct {
	Repo   *repo.RequestRepo
	Owners SoleOwnerLookup
}

// SubmitAccessRequestInput —— 公共 POST /api/v1/access-requests 入参。
// v1 单 owner instance：留言自动绑到 sole owner，无 handle 字段。
type SubmitAccessRequestInput struct {
	Name    string
	Org     string
	Email   string
	Message string
}

// SubmitForOwner —— 公共接口：visitor 留言。
// 必填 email + message；instance 必须已 claim（否则 ErrOwnerNotFound）。
func SubmitForOwner(
	ctx context.Context, deps RequestsDeps, in *SubmitAccessRequestInput,
) (entity.Request, error) {
	if !validSubmitInput(in) {
		return entity.Request{}, apierr.ErrEmptyField
	}
	ownerID, err := deps.Owners.SoleOwnerID(ctx)
	if err != nil {
		return entity.Request{}, fmt.Errorf("resolve sole owner: %w", err)
	}
	out, err := deps.Repo.Create(ctx, &entity.CreateAccessRequestInput{
		OwnerID: ownerID, Name: in.Name, Org: in.Org,
		Email: in.Email, Message: in.Message,
	})
	if err != nil {
		return entity.Request{}, fmt.Errorf("create access request: %w", err)
	}
	return out, nil
}

func validSubmitInput(in *SubmitAccessRequestInput) bool {
	return in.Email != "" && in.Message != ""
}

// ListForOwner —— admin list。status 可空，空 = 全部。
func ListForOwner(
	ctx context.Context, deps RequestsDeps, ownerID, status string,
) ([]entity.Request, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	if !validStatusFilter(status) {
		return nil, entity.ErrAccessRequestStatusInvalid
	}
	rows, err := deps.Repo.ListByOwner(ctx, ownerID, status)
	if err != nil {
		return nil, fmt.Errorf("list access requests: %w", err)
	}
	return rows, nil
}

// UpdateAccessRequestStatus —— admin 改 status。status 必须是 open/replied/closed。
func UpdateAccessRequestStatus(
	ctx context.Context, deps RequestsDeps, ownerID, id, status string,
) (entity.Request, error) {
	if ownerID == "" || id == "" {
		return entity.Request{}, apierr.ErrEmptyField
	}
	if !validStatus(status) {
		return entity.Request{}, entity.ErrAccessRequestStatusInvalid
	}
	out, err := deps.Repo.UpdateStatus(ctx, ownerID, id, status)
	if err != nil {
		return entity.Request{}, fmt.Errorf("update access request: %w", err)
	}
	return out, nil
}

// validStatus —— 写入用：必须是三个 enum 之一。
func validStatus(s string) bool {
	return s == "open" || s == "replied" || s == "closed"
}

// validStatusFilter —— list 过滤用：空 = 不过滤；非空必须合法。
func validStatusFilter(s string) bool {
	return s == "" || validStatus(s)
}

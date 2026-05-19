// access_requests.go —— /<handle>/gate 留言的创建 + admin 审阅。
//
// 业务逻辑薄：handle → owner_id lookup + 必填字段校验。状态机由 domain
// 层和 DB CHECK 共同把守，usecase 只做"白名单"判断。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// AccessRequestsDeps —— SubmitForHandle / ListForOwner / UpdateStatus 共享依赖。
type AccessRequestsDeps struct {
	Repo   *postgres.AccessRequestRepo
	Owners *postgres.OwnerRepo
}

// SubmitAccessRequestInput —— 公共 POST /api/v1/access-requests 入参。
// handle 用来反查 owner_id；其它字段直接落 DB。
type SubmitAccessRequestInput struct {
	Handle  string
	Name    string
	Org     string
	Email   string
	Message string
}

// SubmitForHandle —— 公共接口：visitor 留言。
// 必填 handle + email + message；其它放空字段。
func SubmitForHandle(
	ctx context.Context, deps AccessRequestsDeps, in *SubmitAccessRequestInput,
) (domain.AccessRequest, error) {
	if !validSubmitInput(in) {
		return domain.AccessRequest{}, ErrEmptyField
	}
	owner, err := lookupOwnerForRequest(ctx, deps, in.Handle)
	if err != nil {
		return domain.AccessRequest{}, err
	}
	out, err := deps.Repo.Create(ctx, &domain.CreateAccessRequestInput{
		OwnerID: owner.ID, Name: in.Name, Org: in.Org,
		Email: in.Email, Message: in.Message,
	})
	if err != nil {
		return domain.AccessRequest{}, fmt.Errorf("create access request: %w", err)
	}
	return out, nil
}

func validSubmitInput(in *SubmitAccessRequestInput) bool {
	return in.Handle != "" && in.Email != "" && in.Message != ""
}

func lookupOwnerForRequest(
	ctx context.Context, deps AccessRequestsDeps, handle string,
) (domain.Owner, error) {
	owner, err := deps.Owners.GetByHandle(ctx, handle)
	if err != nil {
		if errors.Is(err, domain.ErrOwnerNotFound) {
			return domain.Owner{}, domain.ErrOwnerNotFound
		}
		return domain.Owner{}, fmt.Errorf("get owner by handle: %w", err)
	}
	return owner, nil
}

// ListForOwner —— admin list。status 可空，空 = 全部。
func ListForOwner(
	ctx context.Context, deps AccessRequestsDeps, ownerID, status string,
) ([]domain.AccessRequest, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	if !validStatusFilter(status) {
		return nil, domain.ErrAccessRequestStatusInvalid
	}
	rows, err := deps.Repo.ListByOwner(ctx, ownerID, status)
	if err != nil {
		return nil, fmt.Errorf("list access requests: %w", err)
	}
	return rows, nil
}

// UpdateAccessRequestStatus —— admin 改 status。status 必须是 open/replied/closed。
func UpdateAccessRequestStatus(
	ctx context.Context, deps AccessRequestsDeps, ownerID, id, status string,
) (domain.AccessRequest, error) {
	if ownerID == "" || id == "" {
		return domain.AccessRequest{}, ErrEmptyField
	}
	if !validStatus(status) {
		return domain.AccessRequest{}, domain.ErrAccessRequestStatusInvalid
	}
	out, err := deps.Repo.UpdateStatus(ctx, ownerID, id, status)
	if err != nil {
		return domain.AccessRequest{}, fmt.Errorf("update access request: %w", err)
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

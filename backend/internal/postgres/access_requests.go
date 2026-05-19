// access_requests.go —— access_requests CRUD。
// 形状对齐 codes.go：Create / List / UpdateStatus 三个最薄方法，DB →
// domain 映射在底部的 toDomainAccessRequest。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// AccessRequestRepo —— access_requests 表的 Repository。
type AccessRequestRepo struct {
	pool *Pool
}

// NewAccessRequestRepo 构造 AccessRequestRepo。
func NewAccessRequestRepo(pool *Pool) *AccessRequestRepo {
	return &AccessRequestRepo{pool: pool}
}

// Create —— 落一条 access request。
func (r *AccessRequestRepo) Create(
	ctx context.Context, in *domain.CreateAccessRequestInput,
) (domain.AccessRequest, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.AccessRequest{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateAccessRequest(ctx, dbq.CreateAccessRequestParams{
		OwnerID: ownerUUID,
		Name:    in.Name,
		Org:     in.Org,
		Email:   in.Email,
		Message: in.Message,
	})
	if err != nil {
		return domain.AccessRequest{}, fmt.Errorf("create access request: %w", err)
	}
	return toDomainAccessRequest(&row), nil
}

// ListByOwner —— admin list；status 为空字符串视为"全部"。
func (r *AccessRequestRepo) ListByOwner(
	ctx context.Context, ownerID, status string,
) ([]domain.AccessRequest, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListAccessRequestsByOwner(ctx, dbq.ListAccessRequestsByOwnerParams{
		OwnerID: ownerUUID,
		Status:  statusFilter(status),
	})
	if err != nil {
		return nil, fmt.Errorf("list access requests: %w", err)
	}
	out := make([]domain.AccessRequest, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAccessRequest(&rows[i]))
	}
	return out, nil
}

// UpdateStatus —— admin 标记 status；不命中返 ErrAccessRequestNotFound。
func (r *AccessRequestRepo) UpdateStatus(
	ctx context.Context, ownerID, id, status string,
) (domain.AccessRequest, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.AccessRequest{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	reqUUID, err := parseUUID(id)
	if err != nil {
		return domain.AccessRequest{}, fmt.Errorf("parse request id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.UpdateAccessRequestStatus(ctx, dbq.UpdateAccessRequestStatusParams{
		ID:      reqUUID,
		OwnerID: ownerUUID,
		Status:  status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AccessRequest{}, domain.ErrAccessRequestNotFound
		}
		return domain.AccessRequest{}, fmt.Errorf("update access request status: %w", err)
	}
	return toDomainAccessRequest(&row), nil
}

// statusFilter —— "" 表示不过滤；其它原样下发到 dbq.Status (*string)。
func statusFilter(status string) *string {
	if status == "" {
		return nil
	}
	return &status
}

func toDomainAccessRequest(a *dbq.AccessRequest) domain.AccessRequest {
	return domain.AccessRequest{
		ID:        formatUUID(a.ID),
		OwnerID:   formatUUID(a.OwnerID),
		Name:      a.Name,
		Org:       a.Org,
		Email:     a.Email,
		Message:   a.Message,
		Status:    a.Status,
		CreatedAt: a.CreatedAt.Time,
	}
}

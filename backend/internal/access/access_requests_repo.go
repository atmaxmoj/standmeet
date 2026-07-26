// access_requests.go —— access_requests CRUD。
// 形状对齐 codes.go：Create / List / UpdateStatus 三个最薄方法，DB →
// domain 映射在底部的 toDomainAccessRequest。

package access

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// AccessRequestRepo —— access_requests 表的 Repository。
type AccessRequestRepo struct { //nolint:revive // mirrors AccessRequest domain term
	pool *pgstore.Pool
}

// NewAccessRequestRepo 构造 AccessRequestRepo。
func NewAccessRequestRepo(pool *pgstore.Pool) *AccessRequestRepo {
	return &AccessRequestRepo{pool: pool}
}

// Create —— 落一条 access request。
func (r *AccessRequestRepo) Create(
	ctx context.Context, in *CreateAccessRequestInput,
) (AccessRequest, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return AccessRequest{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
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
		return AccessRequest{}, fmt.Errorf("create access request: %w", err)
	}
	return toDomainAccessRequest(&row), nil
}

// ListByOwner —— admin list；status 为空字符串视为"全部"。
func (r *AccessRequestRepo) ListByOwner(
	ctx context.Context, ownerID, status string,
) ([]AccessRequest, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListAccessRequestsByOwner(ctx, dbq.ListAccessRequestsByOwnerParams{
		OwnerID:      ownerUUID,
		StatusFilter: statusFilter(status),
	})
	if err != nil {
		return nil, fmt.Errorf("list access requests: %w", err)
	}
	out := make([]AccessRequest, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAccessRequest(&rows[i]))
	}
	return out, nil
}

// GetByID —— 按 (owner, id) 取一条 request；不命中返 ErrAccessRequestNotFound。
// approve 流程先取出 email/name 再 issue+发信。
func (r *AccessRequestRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (AccessRequest, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return AccessRequest{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	reqUUID, ierr := pgstore.ParseUUID(id)
	if ierr != nil {
		return AccessRequest{}, fmt.Errorf("parse request id: %w", ierr)
	}
	row, qerr := dbq.New(r.pool).GetAccessRequestByID(ctx,
		dbq.GetAccessRequestByIDParams{ID: reqUUID, OwnerID: ownerUUID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return AccessRequest{}, ErrAccessRequestNotFound
		}
		return AccessRequest{}, fmt.Errorf("get access request: %w", qerr)
	}
	return toDomainAccessRequest(&row), nil
}

// UpdateStatus —— admin 标记 status；不命中返 ErrAccessRequestNotFound。
func (r *AccessRequestRepo) UpdateStatus(
	ctx context.Context, ownerID, id, status string,
) (AccessRequest, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return AccessRequest{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	reqUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return AccessRequest{}, fmt.Errorf("parse request id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.UpdateAccessRequestStatus(ctx, dbq.UpdateAccessRequestStatusParams{
		ID:      reqUUID,
		OwnerID: ownerUUID,
		Status:  status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AccessRequest{}, ErrAccessRequestNotFound
		}
		return AccessRequest{}, fmt.Errorf("update access request status: %w", err)
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

func toDomainAccessRequest(a *dbq.AccessRequest) AccessRequest {
	return AccessRequest{
		ID:        pgstore.FormatUUID(a.ID),
		OwnerID:   pgstore.FormatUUID(a.OwnerID),
		Name:      a.Name,
		Org:       a.Org,
		Email:     a.Email,
		Message:   a.Message,
		Status:    a.Status,
		CreatedAt: a.CreatedAt.Time,
	}
}

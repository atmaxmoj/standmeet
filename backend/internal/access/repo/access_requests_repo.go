// access_requests.go —— access_requests CRUD.
// Shape mirrors codes.go: three thin methods, Create / List / UpdateStatus, with the
// DB → domain mapping in toDomainAccessRequest at the bottom.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// RequestRepo —— Repository for the access_requests table.
type RequestRepo struct {
	pool *pgstore.Pool
}

// NewAccessRequestRepo constructs a RequestRepo.
func NewAccessRequestRepo(pool *pgstore.Pool) *RequestRepo {
	return &RequestRepo{pool: pool}
}

// Create —— persists one access request.
func (r *RequestRepo) Create(
	ctx context.Context, in *entity.CreateAccessRequestInput,
) (entity.Request, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Request{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	row, err := q.CreateAccessRequest(ctx, db.CreateAccessRequestParams{
		OwnerID: ownerUUID,
		Name:    in.Name,
		Org:     in.Org,
		Email:   in.Email,
		Message: in.Message,
	})
	if err != nil {
		return entity.Request{}, fmt.Errorf("create access request: %w", err)
	}
	return toDomainAccessRequest(&row), nil
}

// ListByOwner —— admin list; an empty status string means "all".
func (r *RequestRepo) ListByOwner(
	ctx context.Context, ownerID, status string,
) ([]entity.Request, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	q := db.New(r.pool)
	rows, err := q.ListAccessRequestsByOwner(ctx, db.ListAccessRequestsByOwnerParams{
		OwnerID:      ownerUUID,
		StatusFilter: statusFilter(status),
	})
	if err != nil {
		return nil, fmt.Errorf("list access requests: %w", err)
	}
	out := make([]entity.Request, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAccessRequest(&rows[i]))
	}
	return out, nil
}

// GetByID —— fetches one request by (owner, id); a miss returns
// ErrAccessRequestNotFound. The approve flow reads email/name here before
// issuing a code and sending the mail.
func (r *RequestRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (entity.Request, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Request{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	reqUUID, ierr := pgstore.ParseUUID(id)
	if ierr != nil {
		return entity.Request{}, fmt.Errorf("parse request id: %w", ierr)
	}
	row, qerr := db.New(r.pool).GetAccessRequestByID(ctx,
		db.GetAccessRequestByIDParams{ID: reqUUID, OwnerID: ownerUUID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Request{}, entity.ErrAccessRequestNotFound
		}
		return entity.Request{}, fmt.Errorf("get access request: %w", qerr)
	}
	return toDomainAccessRequest(&row), nil
}

// UpdateStatus —— admin marks the status; a miss returns ErrAccessRequestNotFound.
func (r *RequestRepo) UpdateStatus(
	ctx context.Context, ownerID, id, status string,
) (entity.Request, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return entity.Request{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	reqUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.Request{}, fmt.Errorf("parse request id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.UpdateAccessRequestStatus(ctx, db.UpdateAccessRequestStatusParams{
		ID:      reqUUID,
		OwnerID: ownerUUID,
		Status:  status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Request{}, entity.ErrAccessRequestNotFound
		}
		return entity.Request{}, fmt.Errorf("update access request status: %w", err)
	}
	return toDomainAccessRequest(&row), nil
}

// statusFilter —— "" means no filter; anything else passes through as-is to
// db.Status (*string).
func statusFilter(status string) *string {
	if status == "" {
		return nil
	}
	return &status
}

func toDomainAccessRequest(a *db.AccessRequest) entity.Request {
	return entity.Request{
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

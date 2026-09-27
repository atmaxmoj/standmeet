// access_requests.go —— access_requests CRUD.
// Shape mirrors codes.go: three thin methods, Create / List / UpdateStatus, with the
// DB → domain mapping in toDomainAccessRequest at the bottom. The owner-notification slot
// bookkeeping lives in access_requests_notify.go.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// RequestRepo —— Repository for the access_requests table.
type RequestRepo struct {
	pool *pgstore.Pool
	q    pgstore.DBTX // nil → the pool; set by With
}

// NewAccessRequestRepo constructs a RequestRepo.
func NewAccessRequestRepo(pool *pgstore.Pool) *RequestRepo {
	return &RequestRepo{pool: pool}
}

// With —— a copy whose every call runs on q (the caller's transaction). The original is unchanged.
func (r *RequestRepo) With(q pgstore.DBTX) *RequestRepo {
	return &RequestRepo{pool: r.pool, q: q}
}

// Pool —— the pool a use case opens its transaction on.
func (r *RequestRepo) Pool() *pgstore.Pool { return r.pool }

// Create —— persists one access request.
func (r *RequestRepo) Create(
	ctx context.Context, in *entity.CreateAccessRequestInput,
) (entity.Request, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Request{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, err := db.New(r.conn()).CreateAccessRequest(ctx, db.CreateAccessRequestParams{
		OwnerID: ownerUUID,
		Name:    in.Name,
		Org:     in.Org,
		Email:   in.Email,
		Message: in.Message,
	})
	if err != nil {
		return entity.Request{}, fmt.Errorf("create access request: %w", err)
	}
	return toDomainAccessRequest((*db.GetAccessRequestByIDRow)(&row)), nil
}

// ListPage —— one page of the admin list, newest first, narrowed by f. The page reports the
// matching total.
func (r *RequestRepo) ListPage(
	ctx context.Context, ownerID string, f entity.RequestFilter, req paging.Request,
) (paging.Page[entity.Request], error) {
	params, err := requestPageParams(ownerID, f, req)
	if err != nil {
		return paging.Page[entity.Request]{}, err
	}
	rows, err := db.New(r.conn()).ListAccessRequestsPage(ctx, params)
	if err != nil {
		return paging.Page[entity.Request]{}, fmt.Errorf("list access requests: %w", err)
	}
	out := make([]entity.Request, 0, len(rows))
	total := int32(0)
	for i := range rows {
		row := &rows[i]
		out = append(out, toDomainAccessRequest(&db.GetAccessRequestByIDRow{
			ID: row.ID, OwnerID: row.OwnerID, Name: row.Name, Org: row.Org, Email: row.Email,
			Message: row.Message, Status: row.Status, CreatedAt: row.CreatedAt,
			MailJobID: row.MailJobID,
		}))
		total = row.Total
	}
	page := paging.Cut(out, req, func(a *entity.Request) paging.Cursor {
		return paging.Cursor{At: a.CreatedAt, ID: a.ID}
	})
	return page.WithTotal(total), nil
}

// GetByID —— fetches one request by (owner, id); a miss returns
// ErrAccessRequestNotFound. The approve flow reads email/name here before
// issuing a code, and the mail jobs read it again when they run.
func (r *RequestRepo) GetByID(
	ctx context.Context, ownerID, id string,
) (entity.Request, error) {
	ids, err := parseRequestIDs(ownerID, id)
	if err != nil {
		return entity.Request{}, err
	}
	row, qerr := db.New(r.conn()).GetAccessRequestByID(ctx,
		db.GetAccessRequestByIDParams{ID: ids.request, OwnerID: ids.owner})
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
	ids, err := parseRequestIDs(ownerID, id)
	if err != nil {
		return entity.Request{}, err
	}
	row, err := db.New(r.conn()).UpdateAccessRequestStatus(ctx, db.UpdateAccessRequestStatusParams{
		ID:      ids.request,
		OwnerID: ids.owner,
		Status:  status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Request{}, entity.ErrAccessRequestNotFound
		}
		return entity.Request{}, fmt.Errorf("update access request status: %w", err)
	}
	return toDomainAccessRequest((*db.GetAccessRequestByIDRow)(&row)), nil
}

// SetMailJob —— the approval mail's job id; its state is the request's mail state. A miss
// returns ErrAccessRequestNotFound.
func (r *RequestRepo) SetMailJob(ctx context.Context, ownerID, id string, jobID int64) error {
	ids, err := parseRequestIDs(ownerID, id)
	if err != nil {
		return err
	}
	n, err := db.New(r.conn()).SetAccessRequestMailJob(ctx, db.SetAccessRequestMailJobParams{
		ID: ids.request, OwnerID: ids.owner, MailJobID: &jobID,
	})
	if err != nil {
		return fmt.Errorf("set access request mail job: %w", err)
	}
	if n == 0 {
		return entity.ErrAccessRequestNotFound
	}
	return nil
}

// conn —— the transaction when bound by With, else the pool.
//
//nolint:ireturn // DBTX is the port both a pool and a transaction satisfy
func (r *RequestRepo) conn() pgstore.DBTX {
	if r.q != nil {
		return r.q
	}
	return r.pool
}

// statusFilter —— "" means no filter; anything else passes through as-is to
// db.Status (*string).
// requestPageParams —— the query's params. An id that is not a uuid names no request: not found,
// never "no id filter" (which would answer with every request).
func requestPageParams(
	ownerID string, f entity.RequestFilter, req paging.Request,
) (db.ListAccessRequestsPageParams, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return db.ListAccessRequestsPageParams{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return db.ListAccessRequestsPageParams{}, fmt.Errorf("list access requests: %w", err)
	}
	only, err := optionalUUID(f.ID)
	if err != nil {
		return db.ListAccessRequestsPageParams{}, entity.ErrAccessRequestNotFound
	}
	return db.ListAccessRequestsPageParams{
		OwnerID: ownerUUID, StatusFilter: statusFilter(f.Status), OnlyID: only,
		AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	}, nil
}

// optionalUUID —— "" is NULL (no filter); anything else must parse.
func optionalUUID(s string) (pgtype.UUID, error) {
	if s == "" {
		return pgtype.UUID{}, nil
	}
	u, err := pgstore.ParseUUID(s)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("parse id: %w", err)
	}
	return u, nil
}

func statusFilter(status string) *string {
	if status == "" {
		return nil
	}
	return &status
}

func toDomainAccessRequest(a *db.GetAccessRequestByIDRow) entity.Request {
	out := entity.Request{
		ID:        pgstore.FormatUUID(a.ID),
		OwnerID:   pgstore.FormatUUID(a.OwnerID),
		Name:      a.Name,
		Org:       a.Org,
		Email:     a.Email,
		Message:   a.Message,
		Status:    a.Status,
		CreatedAt: a.CreatedAt.Time,
	}
	if a.MailJobID != nil {
		out.NoticeJobID = *a.MailJobID
	}
	return out
}

// access_requests.go — creation of /gate messages + admin review.
//
// Business logic is thin: sole owner lookup + required-field validation. The state
// machine is guarded jointly by the domain layer and the DB CHECK constraint; usecase
// only does a "whitelist" check.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// RequestsDeps — shared dependencies for SubmitForOwner / ListForOwner / UpdateStatus.
// Pool and Events are needed by the writes: a request row and its access_request.* event commit
// together. Whoever reacts (the owner notification) is a
// subscriber; this domain sends nothing itself.
type RequestsDeps struct {
	Repo   *repo.RequestRepo
	Owners SoleOwnerLookup
	Pool   *pgstore.Pool
	Events events.Recorder
}

// SubmitAccessRequestInput — public POST /api/v1/access-requests input.
// v1 single-owner instance: the message auto-binds to the sole owner, no handle field.
type SubmitAccessRequestInput struct {
	Name    string
	Org     string
	Email   string
	Message string
}

// SubmitForOwner — public endpoint: a visitor's message.
// Requires email + message; the instance must already be claimed (else ErrOwnerNotFound).
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
	var out entity.Request
	err = pgstore.InTx(ctx, deps.Pool, func(tx pgstore.Tx) error {
		var cerr error
		out, cerr = deps.Repo.With(tx).Create(ctx, &entity.CreateAccessRequestInput{
			OwnerID: ownerID, Name: in.Name, Org: in.Org,
			Email: in.Email, Message: in.Message,
		})
		if cerr != nil {
			return cerr
		}
		data := map[string]string{"request_id": out.ID}
		return deps.Events.With(tx).Record(ctx, ownerID, entity.AccessRequestCreated,
			"access_request/"+out.ID, data)
	})
	if err != nil {
		return entity.Request{}, fmt.Errorf("create access request: %w", err)
	}
	return out, nil
}

func validSubmitInput(in *SubmitAccessRequestInput) bool {
	return in.Email != "" && in.Message != ""
}

// ListForOwner — one page of the admin list. f.Status may be empty; empty = all.
func ListForOwner(
	ctx context.Context, deps RequestsDeps, ownerID string, f entity.RequestFilter,
	req paging.Request,
) (paging.Page[entity.Request], error) {
	if ownerID == "" {
		return paging.Page[entity.Request]{}, apierr.ErrEmptyField
	}
	if !validStatusFilter(f.Status) {
		return paging.Page[entity.Request]{}, entity.ErrAccessRequestStatusInvalid
	}
	page, err := deps.Repo.ListPage(ctx, ownerID, f, req)
	if err != nil {
		return paging.Page[entity.Request]{}, fmt.Errorf("list access requests: %w", err)
	}
	return page, nil
}

// UpdateAccessRequestStatus — admin changes status. status must be open/replied/closed.
func UpdateAccessRequestStatus(
	ctx context.Context, deps RequestsDeps, ownerID, id, status string,
) (entity.Request, error) {
	if ownerID == "" || id == "" {
		return entity.Request{}, apierr.ErrEmptyField
	}
	if !validStatus(status) {
		return entity.Request{}, entity.ErrAccessRequestStatusInvalid
	}
	out, err := setStatus(ctx, deps, ownerID, id, status)
	if err != nil {
		return entity.Request{}, fmt.Errorf("update access request: %w", err)
	}
	return out, nil
}

// setStatus —— the status and its access_request.status_changed, in one transaction.
func setStatus(
	ctx context.Context, deps RequestsDeps, ownerID, id, status string,
) (entity.Request, error) {
	var out entity.Request
	err := pgstore.InTx(ctx, deps.Pool, func(tx pgstore.Tx) error {
		var uerr error
		if out, uerr = deps.Repo.With(tx).UpdateStatus(ctx, ownerID, id, status); uerr != nil {
			return uerr
		}
		data := map[string]string{"request_id": out.ID, "status": out.Status}
		return deps.Events.With(tx).Record(ctx, ownerID, AccessRequestStatusChanged,
			"access_request/"+out.ID, data)
	})
	return out, err
}

// validStatus — for writes: must be one of the three enum values.
func validStatus(s string) bool {
	return s == "open" || s == "replied" || s == "closed"
}

// validStatusFilter — for list filtering: empty = no filter; non-empty must be valid.
func validStatusFilter(s string) bool {
	return s == "" || validStatus(s)
}

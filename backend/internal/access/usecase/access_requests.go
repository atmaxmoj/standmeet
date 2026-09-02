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
)

// RequestsDeps — shared dependencies for SubmitForOwner / ListForOwner / UpdateStatus.
type RequestsDeps struct {
	Repo   *repo.RequestRepo
	Owners SoleOwnerLookup
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

// ListForOwner — admin list. status may be empty; empty = all.
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
	out, err := deps.Repo.UpdateStatus(ctx, ownerID, id, status)
	if err != nil {
		return entity.Request{}, fmt.Errorf("update access request: %w", err)
	}
	return out, nil
}

// validStatus — for writes: must be one of the three enum values.
func validStatus(s string) bool {
	return s == "open" || s == "replied" || s == "closed"
}

// validStatusFilter — for list filtering: empty = no filter; non-empty must be valid.
func validStatusFilter(s string) bool {
	return s == "" || validStatus(s)
}

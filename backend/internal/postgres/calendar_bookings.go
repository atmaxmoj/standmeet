// calendar_bookings.go —— owner_booking_policy + code_bookings 两张表的
// CRUD。从 calendar.go 拆出守 350-line cap。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// ───── booking policy ──────────────────────────────────────────

// UpsertPolicyInput —— set/patch booking policy 入参。
type UpsertPolicyInput struct {
	OwnerID           string
	WorkingHoursStart string
	WorkingHoursEnd   string
	AllowedWeekdays   []string
	MinLeadHours      int32
	BufferMin         int32
}

// UpsertBookingPolicy —— admin patch policy；singleton per-owner。
func (r *CalendarRepo) UpsertBookingPolicy(
	ctx context.Context, in *UpsertPolicyInput,
) (domain.BookingPolicy, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.BookingPolicy{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).UpsertBookingPolicy(ctx, dbq.UpsertBookingPolicyParams{
		OwnerID:           ownerUUID,
		MinLeadHours:      in.MinLeadHours,
		AllowedWeekdays:   in.AllowedWeekdays,
		WorkingHoursStart: in.WorkingHoursStart,
		WorkingHoursEnd:   in.WorkingHoursEnd,
		BufferMin:         in.BufferMin,
	})
	if qerr != nil {
		return domain.BookingPolicy{}, fmt.Errorf("upsert booking policy: %w", qerr)
	}
	return toDomainPolicy(&row, in.OwnerID), nil
}

// GetBookingPolicy —— 没有就返 domain.DefaultBookingPolicy。
func (r *CalendarRepo) GetBookingPolicy(
	ctx context.Context, ownerID string,
) (domain.BookingPolicy, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.BookingPolicy{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).GetBookingPolicy(ctx, ownerUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return domain.DefaultBookingPolicy(ownerID), nil
		}
		return domain.BookingPolicy{}, fmt.Errorf("get booking policy: %w", qerr)
	}
	return toDomainPolicy(&row, ownerID), nil
}

func toDomainPolicy(row *dbq.OwnerBookingPolicy, ownerID string) domain.BookingPolicy {
	return domain.BookingPolicy{
		UpdatedAt:         row.UpdatedAt.Time,
		OwnerID:           ownerID,
		MinLeadHours:      row.MinLeadHours,
		AllowedWeekdays:   row.AllowedWeekdays,
		WorkingHoursStart: row.WorkingHoursStart,
		WorkingHoursEnd:   row.WorkingHoursEnd,
		BufferMin:         row.BufferMin,
	}
}

// ───── code bookings ───────────────────────────────────────────

// CreateBookingInput —— BookMeeting commit 之后写入 ledger 入参。
type CreateBookingInput struct {
	StartAt        time.Time
	EndAt          time.Time
	OwnerID        string
	CodeID         string
	ConversationID string
	GoogleEventID  string
	GoogleHTMLLink string
	Summary        string
	VisitorEmail   string
}

// CreateBooking —— append-only 写一条 code_booking 行。
func (r *CalendarRepo) CreateBooking(
	ctx context.Context, in *CreateBookingInput,
) (domain.CodeBooking, error) {
	params, perr := buildCreateBookingParams(in)
	if perr != nil {
		return domain.CodeBooking{}, perr
	}
	row, qerr := dbq.New(r.pool).CreateCodeBooking(ctx, *params)
	if qerr != nil {
		return domain.CodeBooking{}, fmt.Errorf("create code booking: %w", qerr)
	}
	return toDomainBooking(&row), nil
}

func buildCreateBookingParams(in *CreateBookingInput) (*dbq.CreateCodeBookingParams, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	codeUUID, err := parseUUID(in.CodeID)
	if err != nil {
		return nil, fmt.Errorf("parse code id: %w", err)
	}
	convUUID, err := parseUUID(in.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("parse conv id: %w", err)
	}
	var emailPtr *string
	if in.VisitorEmail != "" {
		v := in.VisitorEmail
		emailPtr = &v
	}
	return &dbq.CreateCodeBookingParams{
		OwnerID:        ownerUUID,
		CodeID:         codeUUID,
		ConversationID: convUUID,
		GoogleEventID:  in.GoogleEventID,
		GoogleHtmlLink: in.GoogleHTMLLink,
		Summary:        in.Summary,
		StartAt:        pgtype.Timestamptz{Time: in.StartAt, Valid: true},
		EndAt:          pgtype.Timestamptz{Time: in.EndAt, Valid: true},
		VisitorEmail:   emailPtr,
	}, nil
}

// CountBookingsForCode —— 配额校验用，计数永不衰减。
func (r *CalendarRepo) CountBookingsForCode(
	ctx context.Context, codeID string,
) (int32, error) {
	codeUUID, err := parseUUID(codeID)
	if err != nil {
		return 0, fmt.Errorf("parse code id: %w", err)
	}
	count, qerr := dbq.New(r.pool).CountBookingsByCode(ctx, codeUUID)
	if qerr != nil {
		return 0, fmt.Errorf("count bookings: %w", qerr)
	}
	return count, nil
}

func toDomainBooking(row *dbq.CodeBooking) domain.CodeBooking {
	out := domain.CodeBooking{
		ID:             formatUUID(row.ID),
		OwnerID:        formatUUID(row.OwnerID),
		CodeID:         formatUUID(row.CodeID),
		ConversationID: formatUUID(row.ConversationID),
		GoogleEventID:  row.GoogleEventID,
		GoogleHTMLLink: row.GoogleHtmlLink,
		Summary:        row.Summary,
		StartAt:        row.StartAt.Time,
		EndAt:          row.EndAt.Time,
		CreatedAt:      row.CreatedAt.Time,
	}
	if row.VisitorEmail != nil {
		out.VisitorEmail = *row.VisitorEmail
	}
	return out
}

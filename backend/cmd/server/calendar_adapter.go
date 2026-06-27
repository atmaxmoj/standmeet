// calendar_adapter.go —— booking-store adapter：把 postgres.CalendarRepo 的**预约存储**方法
// 桥到 usecases.CalendarStore（输入类型差异的字段拷贝）。#155 后，日历**连接器**已归一到
// 统一 connector 层（slot 分派器），这里只剩 booking 持久化——不再有任何 gcal-specific 代码。

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// calendarStoreAdapter —— wraps *postgres.CalendarRepo to satisfy usecases.CalendarStore
// (input-type-only differences between the two)。
type calendarStoreAdapter struct {
	repo *postgres.CalendarRepo
}

func (a calendarStoreAdapter) GetBookingPolicy(
	ctx context.Context, ownerID string,
) (domain.BookingPolicy, error) {
	out, err := a.repo.GetBookingPolicy(ctx, ownerID)
	if err != nil {
		return out, fmt.Errorf("adapter get policy: %w", err)
	}
	return out, nil
}

func (a calendarStoreAdapter) CreateBooking(
	ctx context.Context, in *usecases.CreateBookingInput,
) (domain.CodeBooking, error) {
	out, err := a.repo.CreateBooking(ctx, &postgres.CreateBookingInput{
		OwnerID: in.OwnerID, CodeID: in.CodeID,
		ConversationID: in.ConversationID,
		GoogleEventID:  in.GoogleEventID, GoogleHTMLLink: in.GoogleHTMLLink,
		Summary: in.Summary, StartAt: in.StartAt, EndAt: in.EndAt,
		VisitorEmail: in.VisitorEmail,
	})
	if err != nil {
		return out, fmt.Errorf("adapter create booking: %w", err)
	}
	return out, nil
}

func (a calendarStoreAdapter) CountBookingsForCode(
	ctx context.Context, codeID string,
) (int32, error) {
	out, err := a.repo.CountBookingsForCode(ctx, codeID)
	if err != nil {
		return out, fmt.Errorf("adapter count bookings: %w", err)
	}
	return out, nil
}

func (a calendarStoreAdapter) GetBookingByID(
	ctx context.Context, ownerID, bookingID string,
) (domain.CodeBooking, error) {
	out, err := a.repo.GetBookingByID(ctx, ownerID, bookingID)
	if err != nil {
		return out, fmt.Errorf("adapter get booking: %w", err)
	}
	return out, nil
}

func (a calendarStoreAdapter) DeleteBooking(ctx context.Context, ownerID, bookingID string) error {
	if err := a.repo.DeleteBooking(ctx, ownerID, bookingID); err != nil {
		return fmt.Errorf("adapter delete booking: %w", err)
	}
	return nil
}

// #123: member-scoped 取消隔离门 pass-through (no input translation)。
func (a calendarStoreAdapter) BookingForMemberByEvent(
	ctx context.Context, ownerID, codeID, memberID, eventID string,
) (domain.CodeBooking, error) {
	out, err := a.repo.BookingForMemberByEvent(ctx, ownerID, codeID, memberID, eventID)
	if err != nil {
		return out, fmt.Errorf("adapter booking for member by event: %w", err)
	}
	return out, nil
}

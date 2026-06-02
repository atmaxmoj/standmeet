// calendar_adapter.go —— adapters bridging postgres.CalendarRepo and
// gcal.Client to the usecases.CalendarStore / usecases.CalendarClient
// interfaces. The interfaces use usecases-local input types so the
// usecases package can be tested without dragging postgres in; this
// composition-root adapter does the trivial field copy.

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gcal"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// calendarStoreAdapter —— wraps *postgres.CalendarRepo to satisfy
// usecases.CalendarStore (input-type-only differences between the two).
type calendarStoreAdapter struct {
	repo *postgres.CalendarRepo
}

func (a calendarStoreAdapter) GetConnector(
	ctx context.Context, ownerID, provider string,
) (domain.CalendarConnector, error) {
	out, err := a.repo.GetConnector(ctx, ownerID, provider)
	if err != nil {
		return out, fmt.Errorf("adapter get connector: %w", err)
	}
	return out, nil
}

func (a calendarStoreAdapter) SaveTokens(
	ctx context.Context, in *usecases.SaveTokensInput,
) error {
	if err := a.repo.SaveTokens(ctx, &postgres.SaveTokensInput{
		OwnerID: in.OwnerID, Provider: in.Provider,
		AccessToken: in.AccessToken, RefreshToken: in.RefreshToken,
		ExpiresAt: in.ExpiresAt, Scopes: in.Scopes,
	}); err != nil {
		return fmt.Errorf("adapter save tokens: %w", err)
	}
	return nil
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

// E-14c additions: GetBookingByID + DeleteBooking pass-through (no
// input-type translation needed; method names match usecases interface).

func (a calendarStoreAdapter) GetBookingByID(
	ctx context.Context, ownerID, bookingID string,
) (domain.CodeBooking, error) {
	out, err := a.repo.GetBookingByID(ctx, ownerID, bookingID)
	if err != nil {
		return out, fmt.Errorf("adapter get booking: %w", err)
	}
	return out, nil
}

func (a calendarStoreAdapter) DeleteBooking(
	ctx context.Context, ownerID, bookingID string,
) error {
	if err := a.repo.DeleteBooking(ctx, ownerID, bookingID); err != nil {
		return fmt.Errorf("adapter delete booking: %w", err)
	}
	return nil
}

// calendarClientAdapter —— wraps *gcal.Client.
type calendarClientAdapter struct {
	client *gcal.Client
}

func (a calendarClientAdapter) FreeBusy(
	ctx context.Context, in *gcal.FreeBusyInput,
) ([]gcal.BusyWindow, error) {
	out, err := a.client.FreeBusy(ctx, in)
	if err != nil {
		return out, fmt.Errorf("adapter freebusy: %w", err)
	}
	return out, nil
}

func (a calendarClientAdapter) InsertEvent(
	ctx context.Context, in *gcal.InsertEventInput,
) (gcal.InsertedEvent, error) {
	out, err := a.client.InsertEvent(ctx, in)
	if err != nil {
		return out, fmt.Errorf("adapter insert event: %w", err)
	}
	return out, nil
}

func (a calendarClientAdapter) RefreshToken(
	ctx context.Context, in gcal.RefreshTokenInput,
) (gcal.TokenResponse, error) {
	out, err := a.client.RefreshToken(ctx, in)
	if err != nil {
		return out, fmt.Errorf("adapter refresh token: %w", err)
	}
	return out, nil
}

// E-14c addition: DeleteEvent pass-through for cancel_booking path.
func (a calendarClientAdapter) DeleteEvent(
	ctx context.Context, in *gcal.DeleteEventInput,
) error {
	if err := a.client.DeleteEvent(ctx, in); err != nil {
		return fmt.Errorf("adapter delete event: %w", err)
	}
	return nil
}

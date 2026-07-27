// booking_store_capstore.go —— #187 capstore-canonical booking store.
//
// The sandbox booker persists bookings to its ISOLATED capstore ("bookings" collection). The host
// (composition root) reads/deletes that same capstore for the owner-facing features the sandbox
// can't serve: admin bookings list, owner cancel-by-id, visitor cancel-own (member-scoped). This
// replaces the old postgres code_bookings path, whose only writer (BookMeeting) was retired when
// the visitor book tool moved to the sandbox — so code_bookings never received chat bookings.
//
// booking.ID = capstore record uuid (a stable host handle; not part of the sandbox vocabulary).
// The member-isolation for visitor cancel resolves conversation → member via postgres (the doc
// only carries conversation_id), keeping the sandbox untouched.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/plugins/booker"
	"github.com/atmaxmoj/standmeet/internal/plugins/ownercore"
)

const capstoreBookingsColl = "bookings"

// capstoreBookingDoc —— mirrors the sandbox booker's persisted booking (mcp-servers/booker).
type capstoreBookingDoc struct {
	StartAt        time.Time `json:"start_at"`
	EndAt          time.Time `json:"end_at"`
	OwnerID        string    `json:"owner_id"`
	CodeID         string    `json:"code_id"`
	ConversationID string    `json:"conversation_id"`
	GoogleEventID  string    `json:"google_event_id"`
	GoogleHTMLLink string    `json:"google_html_link"`
	Summary        string    `json:"summary"`
	VisitorEmail   string    `json:"visitor_email"`
}

// convMemberResolver —— resolves a conversation to its owning member (postgres). Injected so the
// store stays testable + keeps postgres types out of the reasoning.
type convMemberResolver interface {
	ConversationMemberID(ctx context.Context, ownerID, conversationID string) (string, error)
}

// capstoreBookingStore —— host booking store over booker's capstore. Satisfies booker.CalendarStore
// + CancelBookingStore + VisitorCancelStore + the admin BookingLister.
type capstoreBookingStore struct {
	store   *capstore.Store
	members convMemberResolver
	policy  bookerPolicyStore
}

func newCapstoreBookingStore(d *runtimeDeps) capstoreBookingStore {
	return capstoreBookingStore{
		store:   capstore.New(d.db),
		policy:  newBookerPolicyStore(d),
		members: d.chatRepo,
	}
}

// GetBookingPolicy —— booker's capstore policy (same source the sandbox reads).
func (s capstoreBookingStore) GetBookingPolicy(
	ctx context.Context, ownerID string,
) (booker.BookingPolicy, error) {
	return s.policy.Get(ctx, ownerID)
}

// UpsertBookingPolicy —— owner sets its booking policy (owner MCP booking cap) into booker's
// capstore policy — the same doc the sandbox booker + admin /booking-policy read.
func (s capstoreBookingStore) UpsertBookingPolicy(
	ctx context.Context, in *ownercore.BookingPolicyUpsert,
) (booker.BookingPolicy, error) {
	p := booker.BookingPolicy{
		OwnerID: in.OwnerID, WorkingHoursStart: in.WorkingHoursStart,
		WorkingHoursEnd: in.WorkingHoursEnd, AllowedWeekdays: in.AllowedWeekdays,
		MinLeadDays: in.MinLeadDays, BufferMin: in.BufferMin,
	}
	if err := s.policy.Set(ctx, in.OwnerID, &p); err != nil {
		return booker.BookingPolicy{}, fmt.Errorf("upsert policy: %w", err)
	}
	return s.policy.Get(ctx, in.OwnerID)
}

// CreateBooking —— host-side insert (interface completeness; chat bookings come from the sandbox).
func (s capstoreBookingStore) CreateBooking(
	ctx context.Context, in *booker.CreateBookingInput,
) (booker.CodeBooking, error) {
	doc, merr := json.Marshal(capstoreBookingDoc{
		OwnerID: in.OwnerID, CodeID: in.CodeID, ConversationID: in.ConversationID,
		GoogleEventID: in.GoogleEventID, GoogleHTMLLink: in.GoogleHTMLLink,
		Summary: in.Summary, VisitorEmail: in.VisitorEmail,
		StartAt: in.StartAt, EndAt: in.EndAt,
	})
	if merr != nil {
		return booker.CodeBooking{}, fmt.Errorf("booking encode: %w", merr)
	}
	id, err := s.store.Insert(ctx, bookerCapKind, bookerCapID, capstoreBookingsColl, doc)
	if err != nil {
		return booker.CodeBooking{}, fmt.Errorf("booking insert: %w", err)
	}
	return booker.CodeBooking{
		ID: id, OwnerID: in.OwnerID, CodeID: in.CodeID, ConversationID: in.ConversationID,
		GoogleEventID: in.GoogleEventID, GoogleHTMLLink: in.GoogleHTMLLink,
		Summary: in.Summary, VisitorEmail: in.VisitorEmail, StartAt: in.StartAt, EndAt: in.EndAt,
	}, nil
}

// CountBookingsForCode —— capstore count of this code's bookings.
func (s capstoreBookingStore) CountBookingsForCode(
	ctx context.Context, codeID string,
) (int32, error) {
	f, merr := json.Marshal(map[string]string{"code_id": codeID})
	if merr != nil {
		return 0, fmt.Errorf("count filter: %w", merr)
	}
	n, err := s.store.Count(ctx, bookerCapKind, bookerCapID, capstoreBookingsColl, f)
	if err != nil {
		return 0, fmt.Errorf("booking count: %w", err)
	}
	return int32(n), nil
}

// GetBookingByID —— owner-scoped fetch by capstore record id.
func (s capstoreBookingStore) GetBookingByID(
	ctx context.Context, ownerID, bookingID string,
) (booker.CodeBooking, error) {
	recs, err := s.bookings(ctx, map[string]string{"owner_id": ownerID})
	if err != nil {
		return booker.CodeBooking{}, err
	}
	for i := range recs {
		if recs[i].ID == bookingID {
			return recordToBooking(&recs[i])
		}
	}
	return booker.CodeBooking{}, booker.ErrBookingNotFound
}

// DeleteBooking —— owner-scoped hard delete by record id.
func (s capstoreBookingStore) DeleteBooking(ctx context.Context, ownerID, bookingID string) error {
	if _, err := s.GetBookingByID(ctx, ownerID, bookingID); err != nil {
		return err // owner scope + existence
	}
	n, err := s.store.DeleteByID(ctx, bookerCapKind, bookerCapID, capstoreBookingsColl, bookingID)
	if err != nil {
		return fmt.Errorf("booking delete: %w", err)
	}
	if n == 0 {
		return booker.ErrBookingNotFound
	}
	return nil
}

// BookingForMemberByEvent —— visitor-cancel isolation: match by event within (owner,code), then
// require the booking's conversation to belong to memberID. Any mismatch → ErrBookingNotFound.
func (s capstoreBookingStore) BookingForMemberByEvent(
	ctx context.Context, ownerID, codeID, memberID, eventID string,
) (booker.CodeBooking, error) {
	recs, err := s.bookings(ctx, map[string]string{
		"owner_id": ownerID, "code_id": codeID, "google_event_id": eventID,
	})
	if err != nil {
		return booker.CodeBooking{}, err
	}
	for i := range recs {
		if bk, ok := s.memberBooking(ctx, ownerID, memberID, &recs[i]); ok {
			return bk, nil
		}
	}
	return booker.CodeBooking{}, booker.ErrBookingNotFound
}

// ListBookingsByOwner —— admin bookings list, capped at limit.
func (s capstoreBookingStore) ListBookingsByOwner(
	ctx context.Context, ownerID string, limit int32,
) ([]booker.CodeBooking, error) {
	recs, err := s.bookings(ctx, map[string]string{"owner_id": ownerID})
	if err != nil {
		return nil, err
	}
	out := make([]booker.CodeBooking, 0, len(recs))
	for i := range recs {
		bk, derr := recordToBooking(&recs[i])
		if derr != nil {
			return nil, derr
		}
		out = append(out, bk)
		if int32(len(out)) >= limit {
			break
		}
	}
	return out, nil
}

// memberBooking —— decode a record + require its conversation to belong to memberID. A decode or
// resolve error or member mismatch → (zero, false); caller treats that as "not this member's".
func (s capstoreBookingStore) memberBooking(
	ctx context.Context, ownerID, memberID string, r *capstore.Record,
) (booker.CodeBooking, bool) {
	bk, derr := recordToBooking(r)
	if derr != nil {
		return booker.CodeBooking{}, false
	}
	owner, merr := s.members.ConversationMemberID(ctx, ownerID, bk.ConversationID)
	if merr != nil || owner != memberID {
		return booker.CodeBooking{}, false
	}
	return bk, true
}

func (s capstoreBookingStore) bookings(
	ctx context.Context, filter map[string]string,
) ([]capstore.Record, error) {
	f, merr := json.Marshal(filter)
	if merr != nil {
		return nil, fmt.Errorf("booking filter: %w", merr)
	}
	recs, err := s.store.QueryWithIDs(ctx, bookerCapKind, bookerCapID, capstoreBookingsColl, f)
	if err != nil {
		return nil, fmt.Errorf("booking query: %w", err)
	}
	return recs, nil
}

func recordToBooking(r *capstore.Record) (booker.CodeBooking, error) {
	var doc capstoreBookingDoc
	if err := json.Unmarshal(r.Doc, &doc); err != nil {
		return booker.CodeBooking{}, fmt.Errorf("booking decode: %w", err)
	}
	return booker.CodeBooking{
		ID: r.ID, OwnerID: doc.OwnerID, CodeID: doc.CodeID,
		ConversationID: doc.ConversationID, GoogleEventID: doc.GoogleEventID,
		GoogleHTMLLink: doc.GoogleHTMLLink, Summary: doc.Summary,
		VisitorEmail: doc.VisitorEmail, StartAt: doc.StartAt, EndAt: doc.EndAt,
	}, nil
}

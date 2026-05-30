// calendar_book.go —— BookMeeting usecase orchestration:
//   1. ensure connector connected + token fresh (refresh if stale)
//   2. evaluate booking policy for each preferred_time
//   3. query Google FreeBusy on policy-passing slots
//   4. pick first slot that passes both gates; on Events.insert success
//      persist code_bookings row
//   5. return typed BookResult (OK + event info, or Reason + hints)
//
// 配额校验 (max_bookings) 在 visitor_chat_book_tool 层做（tool dispatcher
// 拿到调用时检查），不在这里。

package usecases

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/gcal"
)

// CalendarClient —— gcal.Client 抽象，方便 fake 测试 (实际 wireup 注入
// *gcal.Client)。
type CalendarClient interface {
	FreeBusy(ctx context.Context, in *gcal.FreeBusyInput) ([]gcal.BusyWindow, error)
	InsertEvent(ctx context.Context, in *gcal.InsertEventInput) (gcal.InsertedEvent, error)
	RefreshToken(ctx context.Context, in gcal.RefreshTokenInput) (gcal.TokenResponse, error)
}

// CalendarStore —— BookMeeting 需要的持久化能力。
type CalendarStore interface {
	GetConnector(ctx context.Context, ownerID, provider string) (domain.CalendarConnector, error)
	SaveTokens(ctx context.Context, in *SaveTokensInput) error
	GetBookingPolicy(ctx context.Context, ownerID string) (domain.BookingPolicy, error)
	CreateBooking(ctx context.Context, in *CreateBookingInput) (domain.CodeBooking, error)
	CountBookingsForCode(ctx context.Context, codeID string) (int32, error)
}

// SaveTokensInput / CreateBookingInput —— 镜像 postgres.CalendarRepo 的同
// 名 input；usecases 不直接 import postgres input 包以保 deps boundary。
type SaveTokensInput struct {
	OwnerID, Provider, AccessToken, RefreshToken string
	ExpiresAt                                    time.Time
	Scopes                                       []string
}

// CreateBookingInput 同上。
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

// BookMeetingInput —— 一次 calendar.book tool 调用的入参。
type BookMeetingInput struct {
	OwnerID        string
	OwnerTZ        string
	CodeID         string
	ConversationID string
	VisitorName    string
	Topic          string
	VisitorEmail   string
	PreferredTimes []time.Time
	DurationMin    int
}

// BookMeeting —— 主流程。
func BookMeeting(
	ctx context.Context, client CalendarClient, store CalendarStore,
	in *BookMeetingInput,
) (domain.BookResult, error) {
	conn, err := store.GetConnector(ctx, in.OwnerID, domain.CalendarProvider)
	if err != nil {
		return domain.BookResult{}, fmt.Errorf("load connector: %w", err)
	}
	if !conn.Connected() {
		return domain.BookResult{}, domain.ErrCalendarNotConnected
	}
	access, terr := ensureFreshToken(ctx, client, store, &conn)
	if terr != nil {
		return domain.BookResult{}, terr
	}
	policy, perr := store.GetBookingPolicy(ctx, in.OwnerID)
	if perr != nil {
		return domain.BookResult{}, fmt.Errorf("load policy: %w", perr)
	}
	return tryBookingSlots(ctx, client, store, &bookCtx{
		in: in, policy: &policy, conn: &conn, accessToken: access,
	})
}

type bookCtx struct {
	in          *BookMeetingInput
	policy      *domain.BookingPolicy
	conn        *domain.CalendarConnector
	accessToken string
}

// tryBookingSlots —— policy → freebusy → insert，按 preferred_times 顺序
// 第一个通过的就落。所有 slot 都失败 → BookResult{OK:false} + Reason。
func tryBookingSlots(
	ctx context.Context, client CalendarClient, store CalendarStore, b *bookCtx,
) (domain.BookResult, error) {
	policyReasons := collectPolicyReasons(b)
	if len(policyReasons.passed) == 0 {
		return buildPolicyFailure(b, policyReasons), nil
	}
	busy, ferr := queryFreeBusy(ctx, client, b, policyReasons.passed)
	if ferr != nil {
		return domain.BookResult{}, ferr
	}
	slot, ok := pickFreeSlot(policyReasons.passed, b.in.DurationMin, busy)
	if !ok {
		return buildBusyFailure(b, busy), nil
	}
	return commitBooking(ctx, client, store, b, slot)
}

type collectedPolicy struct {
	worstReason domain.BookConflictReason
	passed      []time.Time
}

func collectPolicyReasons(b *bookCtx) collectedPolicy {
	out := collectedPolicy{}
	for _, t := range b.in.PreferredTimes {
		res, err := evaluatePolicy(b.policy, b.in.OwnerTZ, t, b.in.DurationMin)
		if err != nil || res.Reason != "" {
			if res.Reason != "" {
				out.worstReason = res.Reason
			}
			continue
		}
		out.passed = append(out.passed, t)
	}
	return out
}

func buildPolicyFailure(b *bookCtx, p collectedPolicy) domain.BookResult {
	return domain.BookResult{
		OK:         false,
		Reason:     p.worstReason,
		PolicyHint: policyHint(b.policy, b.in.OwnerTZ),
	}
}

func buildBusyFailure(b *bookCtx, busy []gcal.BusyWindow) domain.BookResult {
	wins := make([]domain.BookBusyWindow, 0, len(busy))
	for i := range busy {
		wins = append(wins, domain.BookBusyWindow{
			Start: busy[i].Start.Format(time.RFC3339),
			End:   busy[i].End.Format(time.RFC3339),
		})
	}
	return domain.BookResult{
		OK:          false,
		Reason:      domain.BookConflictAllBusy,
		BusyWindows: wins,
		PolicyHint:  policyHint(b.policy, b.in.OwnerTZ),
	}
}

func queryFreeBusy(
	ctx context.Context, client CalendarClient, b *bookCtx, slots []time.Time,
) ([]gcal.BusyWindow, error) {
	span := freebusySpan(slots, b.in.DurationMin)
	busy, err := client.FreeBusy(ctx, &gcal.FreeBusyInput{
		AccessToken: b.accessToken,
		TimeMin:     span.min,
		TimeMax:     span.max,
		CalendarIDs: []string{"primary"},
		TimeZone:    "UTC",
	})
	if err != nil {
		return nil, fmt.Errorf("freebusy: %w", err)
	}
	return busy, nil
}

type spanRange struct {
	min, max time.Time
}

func freebusySpan(slots []time.Time, durationMin int) spanRange {
	r := spanRange{min: slots[0], max: slots[0]}
	for _, s := range slots {
		if s.Before(r.min) {
			r.min = s
		}
		if s.After(r.max) {
			r.max = s
		}
	}
	r.max = r.max.Add(time.Duration(durationMin) * time.Minute)
	return r
}

func pickFreeSlot(
	slots []time.Time, durationMin int, busy []gcal.BusyWindow,
) (time.Time, bool) {
	dur := time.Duration(durationMin) * time.Minute
	for _, s := range slots {
		if !slotConflicts(s, dur, busy) {
			return s, true
		}
	}
	return time.Time{}, false
}

func slotConflicts(start time.Time, dur time.Duration, busy []gcal.BusyWindow) bool {
	end := start.Add(dur)
	for _, b := range busy {
		if start.Before(b.End) && end.After(b.Start) {
			return true
		}
	}
	return false
}

func commitBooking(
	ctx context.Context, client CalendarClient, store CalendarStore,
	b *bookCtx, slot time.Time,
) (domain.BookResult, error) {
	end := slot.Add(time.Duration(b.in.DurationMin) * time.Minute)
	atts := buildAttendees(b.in.VisitorEmail)
	inserted, err := client.InsertEvent(ctx, &gcal.InsertEventInput{
		AccessToken: b.accessToken,
		CalendarID:  "primary",
		Summary:     buildSummary(b.in),
		Description: b.in.Topic,
		Start:       slot, End: end,
		TimeZone:    b.in.OwnerTZ,
		Attendees:   atts,
		SendUpdates: sendUpdatesFor(b.in.VisitorEmail),
	})
	if err != nil {
		return domain.BookResult{}, fmt.Errorf("insert event: %w", err)
	}
	if perr := persistBooking(ctx, store, &persistArgs{
		b: b, inserted: &inserted, start: slot, end: end,
	}); perr != nil {
		return domain.BookResult{}, perr
	}
	return domain.BookResult{
		OK: true, EventID: inserted.EventID, HTMLLink: inserted.HTMLLink,
		Start: slot, End: end,
	}, nil
}

func buildSummary(in *BookMeetingInput) string {
	parts := []string{}
	if in.VisitorName != "" {
		parts = append(parts, in.VisitorName)
	}
	parts = append(parts, in.Topic)
	return strings.Join(parts, " — ")
}

func buildAttendees(email string) []gcal.EventAttendee {
	if email == "" {
		return []gcal.EventAttendee{}
	}
	return []gcal.EventAttendee{{Email: email}}
}

func sendUpdatesFor(email string) string {
	if email == "" {
		return "none"
	}
	return "all"
}

type persistArgs struct {
	b        *bookCtx
	inserted *gcal.InsertedEvent
	start    time.Time
	end      time.Time
}

func persistBooking(
	ctx context.Context, store CalendarStore, a *persistArgs,
) error {
	_, err := store.CreateBooking(ctx, &CreateBookingInput{
		OwnerID:        a.b.in.OwnerID,
		CodeID:         a.b.in.CodeID,
		ConversationID: a.b.in.ConversationID,
		GoogleEventID:  a.inserted.EventID,
		GoogleHTMLLink: a.inserted.HTMLLink,
		Summary:        buildSummary(a.b.in),
		StartAt:        a.start,
		EndAt:          a.end,
		VisitorEmail:   a.b.in.VisitorEmail,
	})
	if err != nil {
		return fmt.Errorf("persist booking: %w", err)
	}
	return nil
}

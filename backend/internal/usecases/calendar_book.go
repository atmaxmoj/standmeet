// calendar_book.go —— BookMeeting usecase orchestration:
//   1. ensure connector connected (CalendarProxy.Connected)
//   2. evaluate booking policy for each preferred_time
//   3. query FreeBusy on policy-passing slots (via proxy)
//   4. pick first slot that passes both gates; on InsertEvent success
//      persist code_bookings row
//   5. return typed BookResult (OK + event info, or Reason + hints)
//
// 凭据/token 刷新全在 CalendarProxy（internal/connector）里，这层只拿 ownerID
// 句柄。配额校验 (max_bookings) 在 tool dispatcher 层做，不在这里。

package usecases

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// CalendarStore —— BookMeeting 需要的预约持久化。连接器/凭据/token 已挪进
// CalendarProxy；这里只剩 booking policy + booking 行。
type CalendarStore interface {
	GetBookingPolicy(ctx context.Context, ownerID string) (domain.BookingPolicy, error)
	CreateBooking(ctx context.Context, in *CreateBookingInput) (domain.CodeBooking, error)
	CountBookingsForCode(ctx context.Context, codeID string) (int32, error)
}

// CreateBookingInput —— 镜像 postgres.CalendarRepo 的同名 input。
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
	ctx context.Context, proxy CalendarProxy, store CalendarStore,
	in *BookMeetingInput,
) (domain.BookResult, error) {
	connected, err := proxy.Connected(ctx, in.OwnerID)
	if err != nil {
		return domain.BookResult{}, fmt.Errorf("connector status: %w", err)
	}
	if !connected {
		return domain.BookResult{}, domain.ErrCalendarNotConnected
	}
	policy, perr := store.GetBookingPolicy(ctx, in.OwnerID)
	if perr != nil {
		return domain.BookResult{}, fmt.Errorf("load policy: %w", perr)
	}
	return tryBookingSlots(ctx, proxy, store, &bookCtx{in: in, policy: &policy})
}

type bookCtx struct {
	in     *BookMeetingInput
	policy *domain.BookingPolicy
}

// tryBookingSlots —— policy → freebusy → insert，按 preferred_times 顺序第一个
// 通过的就落。所有 slot 都失败 → BookResult{OK:false} + Reason。
func tryBookingSlots(
	ctx context.Context, proxy CalendarProxy, store CalendarStore, b *bookCtx,
) (domain.BookResult, error) {
	policyReasons := collectPolicyReasons(b)
	if len(policyReasons.passed) == 0 {
		return buildPolicyFailure(b, policyReasons), nil
	}
	busy, ferr := queryFreeBusy(ctx, proxy, b, policyReasons.passed)
	if ferr != nil {
		return domain.BookResult{}, ferr
	}
	slot, ok := pickFreeSlot(policyReasons.passed, b.in.DurationMin, busy)
	if !ok {
		return buildBusyFailure(b, busy), nil
	}
	return commitBooking(ctx, proxy, store, b, slot)
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

func buildBusyFailure(b *bookCtx, busy []BusyInterval) domain.BookResult {
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
	ctx context.Context, proxy CalendarProxy, b *bookCtx, slots []time.Time,
) ([]BusyInterval, error) {
	span := freebusySpan(slots, b.in.DurationMin)
	busy, err := proxy.FreeBusy(ctx, b.in.OwnerID,
		FreeBusyReq{TimeMin: span.min, TimeMax: span.max})
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
	slots []time.Time, durationMin int, busy []BusyInterval,
) (time.Time, bool) {
	dur := time.Duration(durationMin) * time.Minute
	for _, s := range slots {
		if !slotConflicts(s, dur, busy) {
			return s, true
		}
	}
	return time.Time{}, false
}

func slotConflicts(start time.Time, dur time.Duration, busy []BusyInterval) bool {
	end := start.Add(dur)
	for _, b := range busy {
		if start.Before(b.End) && end.After(b.Start) {
			return true
		}
	}
	return false
}

func commitBooking(
	ctx context.Context, proxy CalendarProxy, store CalendarStore,
	b *bookCtx, slot time.Time,
) (domain.BookResult, error) {
	end := slot.Add(time.Duration(b.in.DurationMin) * time.Minute)
	inserted, err := proxy.InsertEvent(ctx, b.in.OwnerID, &InsertEventReq{
		Summary:      buildSummary(b.in),
		Description:  b.in.Topic,
		Start:        slot,
		End:          end,
		TimeZone:     b.in.OwnerTZ,
		VisitorEmail: b.in.VisitorEmail,
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

type persistArgs struct {
	b        *bookCtx
	inserted *InsertedEvent
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

// calendar_list_slots.go —— E-14c: owner-side calendar.list_slots usecase。
// 在 [from, until] 时段内枚举 booking policy 通过 + FreeBusy 空闲的
// duration_min 时长 slot。owner AI 在 Claude Code 用 list_slots 帮 visitor
// 找时间 (visitor-side calendar_book 已经走 BookMeeting；这里是 owner 看)。
//
// 算法：
//   1. ensure connector connected (contract.CalendarProxy.Connected)
//   2. policy 枚举：weekday 允许 + working_hours 之内 + 满足 min_lead_days
//      每 step_minutes 起点（默认 30 min）
//   3. 单次 FreeBusy 查 [from, until]（via proxy）
//   4. 过滤掉跟 busy 重叠的 slot；返排好序的 free slot 列表

package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

const (
	defaultSlotStepMin = 30
	maxSlotsReturned   = 50
)

// ListSlotsInput —— owner 视角找时间。
type ListSlotsInput struct {
	From        time.Time
	Until       time.Time
	OwnerID     string
	OwnerTZ     string
	DurationMin int
	StepMin     int // 0 → defaultSlotStepMin
}

// AvailableSlot —— 一个 [Start, End] 候选时间。
type AvailableSlot struct {
	Start time.Time
	End   time.Time
}

// ListAvailableSlots —— 主流程。proxy + store 同 BookMeeting 复用接口。
func ListAvailableSlots(
	ctx context.Context, proxy contract.CalendarProxy, store CalendarStore,
	in *ListSlotsInput,
) ([]AvailableSlot, error) {
	policy, gerr := listSlotsPolicy(ctx, proxy, store, in)
	if gerr != nil {
		return nil, gerr
	}
	candidates := enumerateSlots(&policy, in)
	if len(candidates) == 0 {
		slog.Default().Info("list_slots: no policy-passing candidates",
			"from", in.From.Format(time.RFC3339), "until", in.Until.Format(time.RFC3339),
			"owner_tz", in.OwnerTZ, "weekdays", policy.AllowedWeekdays,
			"hours", policy.WorkingHoursStart+"-"+policy.WorkingHoursEnd,
			"min_lead_days", policy.MinLeadDays)
		return []AvailableSlot{}, nil
	}
	busy, ferr := queryListFreeBusy(ctx, proxy, in)
	if ferr != nil {
		return nil, ferr
	}
	free := filterFreeSlots(candidates, in.DurationMin, busy)
	slog.Default().Info("list_slots: enumerated",
		"from", in.From.Format(time.RFC3339), "until", in.Until.Format(time.RFC3339),
		"owner_tz", in.OwnerTZ, "candidates", len(candidates),
		"busy_windows", len(busy), "free", len(free))
	return free, nil
}

// listSlotsPolicy —— connector connected 闸 + load 政策。从 ListAvailableSlots
// 拆出守 cyclop ≤5。未连 → ErrCalendarNotConnected。
func listSlotsPolicy(
	ctx context.Context, proxy contract.CalendarProxy, store CalendarStore, in *ListSlotsInput,
) (entity.BookingPolicy, error) {
	connected, cErr := proxy.Connected(ctx, in.OwnerID)
	if cErr != nil {
		return entity.BookingPolicy{}, fmt.Errorf("connector status: %w", cErr)
	}
	if !connected {
		return entity.BookingPolicy{}, contract.ErrCalendarNotConnected
	}
	policy, perr := store.GetBookingPolicy(ctx, in.OwnerID)
	if perr != nil {
		return entity.BookingPolicy{}, fmt.Errorf("load policy: %w", perr)
	}
	return policy, nil
}

func queryListFreeBusy(
	ctx context.Context, proxy contract.CalendarProxy, in *ListSlotsInput,
) ([]contract.BusyInterval, error) {
	busy, err := proxy.FreeBusy(ctx, in.OwnerID,
		contract.FreeBusyReq{TimeMin: in.From, TimeMax: in.Until})
	if err != nil {
		return nil, fmt.Errorf("freebusy: %w", err)
	}
	return busy, nil
}

// enumerateSlots —— policy + step → 候选 slot 时间点（不查 FreeBusy）。
func enumerateSlots(policy *entity.BookingPolicy, in *ListSlotsInput) []AvailableSlot {
	step := time.Duration(slotStep(in)) * time.Minute
	dur := time.Duration(in.DurationMin) * time.Minute
	out := make([]AvailableSlot, 0, maxSlotsReturned)
	for t := in.From; shouldKeepEnumerating(t, in.Until, len(out)); t = t.Add(step) {
		if end := t.Add(dur); end.After(in.Until) {
			break
		} else if slotPassesPolicy(policy, in, t) {
			out = append(out, AvailableSlot{Start: t, End: end})
		}
	}
	return out
}

func shouldKeepEnumerating(t, until time.Time, collected int) bool {
	return !t.After(until) && collected < maxSlotsReturned
}

func slotPassesPolicy(
	policy *entity.BookingPolicy, in *ListSlotsInput, t time.Time,
) bool {
	res, err := entity.EvaluatePolicy(policy, in.OwnerTZ, t, in.DurationMin)
	return err == nil && res.Reason == ""
}

func slotStep(in *ListSlotsInput) int {
	if in.StepMin > 0 {
		return in.StepMin
	}
	return defaultSlotStepMin
}

// filterFreeSlots —— 排除跟 busy 任意 window 重叠的 slot。
func filterFreeSlots(
	slots []AvailableSlot, durationMin int, busy []contract.BusyInterval,
) []AvailableSlot {
	dur := time.Duration(durationMin) * time.Minute
	out := make([]AvailableSlot, 0, len(slots))
	for i := range slots {
		if !slotConflicts(slots[i].Start, dur, busy) {
			out = append(out, slots[i])
		}
	}
	return out
}

// slotConflicts —— slot [start, start+dur] 是否跟任一 busy window 重叠。
func slotConflicts(start time.Time, dur time.Duration, busy []contract.BusyInterval) bool {
	end := start.Add(dur)
	for _, b := range busy {
		if start.Before(b.End) && end.After(b.Start) {
			return true
		}
	}
	return false
}

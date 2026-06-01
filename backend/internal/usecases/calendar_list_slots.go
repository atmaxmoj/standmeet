// calendar_list_slots.go —— E-14c: owner-side calendar.list_slots usecase。
// 在 [from, until] 时段内枚举 booking policy 通过 + FreeBusy 空闲的
// duration_min 时长 slot。owner AI 在 Claude Code 用 list_slots 帮 visitor
// 找时间 (visitor-side calendar_book 已经走 BookMeeting；这里是 owner 看)。
//
// 算法：
//   1. ensure connector + token fresh (同 BookMeeting)
//   2. policy 枚举：weekday 允许 + working_hours 之内 + 满足 min_lead_hours
//      每 step_minutes 起点（默认 30 min）
//   3. 单次 FreeBusy 查 [from, until]
//   4. 过滤掉跟 busy 重叠的 slot；返排好序的 free slot 列表

package usecases

import (
	"context"
	"fmt"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/gcal"
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

// ListAvailableSlots —— 主流程。store + client 同 BookMeeting 复用接口。
func ListAvailableSlots(
	ctx context.Context, client CalendarClient, store CalendarStore,
	in *ListSlotsInput,
) ([]AvailableSlot, error) {
	access, aErr := cancelEnsureAccess(ctx, client, store, in.OwnerID)
	if aErr != nil {
		return nil, aErr
	}
	policy, perr := store.GetBookingPolicy(ctx, in.OwnerID)
	if perr != nil {
		return nil, fmt.Errorf("load policy: %w", perr)
	}
	candidates := enumerateSlots(&policy, in)
	if len(candidates) == 0 {
		return []AvailableSlot{}, nil
	}
	busy, ferr := queryListFreeBusy(ctx, client, access, in)
	if ferr != nil {
		return nil, ferr
	}
	return filterFreeSlots(candidates, in.DurationMin, busy), nil
}

func queryListFreeBusy(
	ctx context.Context, client CalendarClient, access string, in *ListSlotsInput,
) ([]gcal.BusyWindow, error) {
	busy, err := client.FreeBusy(ctx, &gcal.FreeBusyInput{
		AccessToken: access,
		TimeMin:     in.From, TimeMax: in.Until,
		CalendarIDs: []string{"primary"}, TimeZone: "UTC",
	})
	if err != nil {
		return nil, fmt.Errorf("freebusy: %w", err)
	}
	return busy, nil
}

// enumerateSlots —— policy + step → 候选 slot 时间点（不查 FreeBusy）。
func enumerateSlots(policy *domain.BookingPolicy, in *ListSlotsInput) []AvailableSlot {
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
	policy *domain.BookingPolicy, in *ListSlotsInput, t time.Time,
) bool {
	res, err := evaluatePolicy(policy, in.OwnerTZ, t, in.DurationMin)
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
	slots []AvailableSlot, durationMin int, busy []gcal.BusyWindow,
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

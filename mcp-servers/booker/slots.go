// slots.go —— list_slots 流程 + slot 算法,港自旧核心 usecases/calendar_list_slots.go。
// #135:算法住在沙箱;外部只留两处走固定词表 —— policy 从 booker 自己的 capstore 取、
// freebusy 经 connector.invoke("calendar","free_busy") 拿。纯枚举/过滤不碰外部。

package main

import (
	"encoding/json"
	"fmt"
	"time"
)

const (
	defaultSlotStepMin = 30
	maxSlotsReturned   = 50
)

// busyInterval —— 一个忙时段(connector.invoke free_busy 的响应形状)。
type busyInterval struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// availableSlot —— 一个 [Start, End] 候选时间。
type availableSlot struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// listSlotsInput —— list_slots 的解析后入参。
type listSlotsInput struct {
	From        time.Time
	Until       time.Time
	DurationMin int
	StepMin     int
}

// loadPolicy —— 从 booker 自己的 capstore 取 owner policy;没设过 → 兜底默认。
func loadPolicy(ownerID string) (bookingPolicy, error) {
	filter, merr := json.Marshal(map[string]string{"owner_id": ownerID})
	if merr != nil {
		return bookingPolicy{}, fmt.Errorf("policy filter: %w", merr)
	}
	recs, err := gwCapstoreQuery("policy", filter)
	if err != nil {
		return bookingPolicy{}, err
	}
	if len(recs) == 0 {
		return defaultBookingPolicy(ownerID), nil
	}
	var p bookingPolicy
	if uerr := json.Unmarshal(recs[0], &p); uerr != nil {
		return bookingPolicy{}, fmt.Errorf("decode policy: %w", uerr)
	}
	return p, nil
}

// gwFreeBusy —— 经 connector.invoke 拿 owner 主日历在 [from,until] 的忙时段。
func gwFreeBusy(ownerID string, from, until time.Time) ([]busyInterval, error) {
	args, merr := json.Marshal(map[string]time.Time{"time_min": from, "time_max": until})
	if merr != nil {
		return nil, fmt.Errorf("marshal free_busy args: %w", merr)
	}
	resp, err := gwConnectorInvoke(ownerID, "calendar", "free_busy", args)
	if err != nil {
		return nil, err
	}
	var busy []busyInterval
	if uerr := json.Unmarshal(resp, &busy); uerr != nil {
		return nil, fmt.Errorf("decode free_busy: %w", uerr)
	}
	return busy, nil
}

// listAvailableSlots —— 主流程:load policy → owner tz → 枚举候选 → freebusy → 过滤。
func listAvailableSlots(ownerID string, in *listSlotsInput) ([]availableSlot, error) {
	policy, perr := loadPolicy(ownerID)
	if perr != nil {
		return nil, perr
	}
	tz, _ := gwOwnerMeta(ownerID, "timezone") // 空 → UTC(loadTimezone 兜底)
	candidates := enumerateSlots(&policy, tz, in)
	if len(candidates) == 0 {
		return []availableSlot{}, nil
	}
	busy, ferr := gwFreeBusy(ownerID, in.From, in.Until)
	if ferr != nil {
		return nil, ferr
	}
	return filterFreeSlots(candidates, in.DurationMin, busy), nil
}

// enumerateSlots —— policy + step → 候选 slot 时间点(不查 FreeBusy)。
func enumerateSlots(policy *bookingPolicy, tz string, in *listSlotsInput) []availableSlot {
	step := time.Duration(slotStep(in)) * time.Minute
	dur := time.Duration(in.DurationMin) * time.Minute
	out := make([]availableSlot, 0, maxSlotsReturned)
	for t := in.From; !t.After(in.Until) && len(out) < maxSlotsReturned; t = t.Add(step) {
		end := t.Add(dur)
		if end.After(in.Until) {
			break
		}
		if reason, err := evaluatePolicy(policy, tz, t, in.DurationMin); err == nil && reason == "" {
			out = append(out, availableSlot{Start: t, End: end})
		}
	}
	return out
}

func slotStep(in *listSlotsInput) int {
	if in.StepMin > 0 {
		return in.StepMin
	}
	return defaultSlotStepMin
}

// filterFreeSlots —— 排除跟 busy 任意 window 重叠的 slot。
func filterFreeSlots(
	slots []availableSlot, durationMin int, busy []busyInterval,
) []availableSlot {
	dur := time.Duration(durationMin) * time.Minute
	out := make([]availableSlot, 0, len(slots))
	for i := range slots {
		if !slotConflicts(slots[i].Start, dur, busy) {
			out = append(out, slots[i])
		}
	}
	return out
}

func slotConflicts(start time.Time, dur time.Duration, busy []busyInterval) bool {
	end := start.Add(dur)
	for _, b := range busy {
		if start.Before(b.End) && end.After(b.Start) {
			return true
		}
	}
	return false
}

// ── calendar_list_slots handler(arg 解析 + wire {ok,slots:[{start,end}]},UTC RFC3339)──

type listSlotsArgsWire struct {
	From        string `json:"from_rfc3339"`
	Until       string `json:"until_rfc3339"`
	DurationMin int    `json:"duration_min"`
	StepMin     int    `json:"step_min"`
}

type slotWire struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type listSlotsResultWire struct {
	Slots []slotWire `json:"slots"`
	OK    bool       `json:"ok"`
}

func doListSlots(s session, rawArgs json.RawMessage) string {
	var w listSlotsArgsWire
	if err := json.Unmarshal(rawArgs, &w); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	in, ew := parseListSlots(&w)
	if ew != "" {
		return ew
	}
	slots, lerr := listAvailableSlots(s.OwnerID, in)
	if lerr != nil {
		return friendlyCalErr(lerr)
	}
	out := listSlotsResultWire{OK: true, Slots: make([]slotWire, 0, len(slots))}
	for i := range slots {
		out.Slots = append(out.Slots, slotWire{
			Start: slots[i].Start.UTC().Format(time.RFC3339),
			End:   slots[i].End.UTC().Format(time.RFC3339),
		})
	}
	return mustJSON(out)
}

func parseListSlots(w *listSlotsArgsWire) (*listSlotsInput, string) {
	if w.From == "" || w.Until == "" {
		return nil, bookErr("invalid_args", "from_rfc3339 + until_rfc3339 required")
	}
	if w.DurationMin < minDurationMin || w.DurationMin > maxDurationMin {
		return nil, bookErr("invalid_args",
			fmt.Sprintf("duration_min must be %d–%d", minDurationMin, maxDurationMin))
	}
	from, ferr := time.Parse(time.RFC3339, w.From)
	if ferr != nil {
		return nil, bookErr("invalid_args", "from_rfc3339 parse: "+ferr.Error())
	}
	until, uerr := time.Parse(time.RFC3339, w.Until)
	if uerr != nil {
		return nil, bookErr("invalid_args", "until_rfc3339 parse: "+uerr.Error())
	}
	return &listSlotsInput{From: from, Until: until, DurationMin: w.DurationMin, StepMin: w.StepMin}, ""
}

// agentskills_booker_slots.go —— G-7: visitor-side calendar_list_slots
// 工具的实现 (spec + decode + execute + marshal)。从 agentskills_booker.go
// 拆出来守 max-lines 350 cap。
//
// 复用 ListAvailableSlots usecase；wire 形态 ({slots:[{start,end}]}) 跟
// owner cap_calendar.go viewSlots 同形态，frontend SlotsCard 共用 narrow。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

func runBookerListSlots(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
	owner *domain.Owner, input []byte,
) (string, error) {
	args, derr := decodeListSlotsArgs(input)
	if derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	slots, lerr := ListAvailableSlots(ctx, deps.GCal, deps.Calendar, &ListSlotsInput{
		OwnerID: in.OwnerID, OwnerTZ: owner.ProfileTimezone,
		From: args.from, Until: args.until,
		DurationMin: args.DurationMin, StepMin: args.StepMin,
	})
	if lerr != nil {
		return marshalBookErrResult("list_slots_failed", lerr.Error()), nil
	}
	return marshalListSlotsResult(slots), nil
}

func listSlotsToolSpec() inference.ToolSpec {
	return inference.ToolSpec{
		Name: toolCalendarListSlotsName,
		Description: "List available [start, end] slots on the owner's calendar " +
			"between from_rfc3339 and until_rfc3339 that pass booking policy and " +
			"don't overlap any busy window. Returns up to 50 slots. Use this " +
			"before calendar_book so the visitor can pick an actual free time.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"from_rfc3339":{"type":"string","description":"Search window start (RFC3339)."},
				"until_rfc3339":{"type":"string","description":"Search window end (RFC3339)."},
				"duration_min":{"type":"integer","minimum":15,"maximum":180,
					"description":"Slot length in minutes."},
				"step_min":{"type":"integer","minimum":15,"maximum":120,
					"description":"Enumeration step in minutes (default 30)."}
			},
			"required":["from_rfc3339","until_rfc3339","duration_min"]
		}`),
	}
}

type listSlotsArgsParsed struct {
	from        time.Time
	until       time.Time
	DurationMin int
	StepMin     int
}

type listSlotsArgsWire struct {
	From        string `json:"from_rfc3339"`
	Until       string `json:"until_rfc3339"`
	DurationMin int    `json:"duration_min"`
	StepMin     int    `json:"step_min"`
}

func decodeListSlotsArgs(input []byte) (listSlotsArgsParsed, error) {
	var args listSlotsArgsWire
	if err := json.Unmarshal(input, &args); err != nil {
		return listSlotsArgsParsed{}, fmt.Errorf("decode args: %w", err)
	}
	if verr := validateListSlotsArgs(&args); verr != nil {
		return listSlotsArgsParsed{}, verr
	}
	return parseListSlotsTimes(&args)
}

func validateListSlotsArgs(args *listSlotsArgsWire) error {
	if args.From == "" || args.Until == "" {
		return errors.New("from_rfc3339 + until_rfc3339 required")
	}
	if args.DurationMin < minDurationMin || args.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d",
			minDurationMin, maxDurationMin)
	}
	return nil
}

func parseListSlotsTimes(args *listSlotsArgsWire) (listSlotsArgsParsed, error) {
	from, fErr := time.Parse(time.RFC3339, args.From)
	if fErr != nil {
		return listSlotsArgsParsed{}, fmt.Errorf("from_rfc3339 parse: %w", fErr)
	}
	until, uErr := time.Parse(time.RFC3339, args.Until)
	if uErr != nil {
		return listSlotsArgsParsed{}, fmt.Errorf("until_rfc3339 parse: %w", uErr)
	}
	return listSlotsArgsParsed{
		from: from, until: until,
		DurationMin: args.DurationMin, StepMin: args.StepMin,
	}, nil
}

type slotWire struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type listSlotsResultWire struct {
	Slots []slotWire `json:"slots"`
	OK    bool       `json:"ok"`
}

func marshalListSlotsResult(slots []AvailableSlot) string {
	out := listSlotsResultWire{
		OK: true, Slots: make([]slotWire, 0, len(slots)),
	}
	for i := range slots {
		out.Slots = append(out.Slots, slotWire{
			Start: slots[i].Start.UTC().Format(time.RFC3339),
			End:   slots[i].End.UTC().Format(time.RFC3339),
		})
	}
	buf, err := json.Marshal(out)
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(buf)
}

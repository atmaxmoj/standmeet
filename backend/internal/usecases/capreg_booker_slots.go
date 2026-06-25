// capreg_booker_slots.go —— calendar_list_slots host op 的 decode + execute +
// marshal。booker.sock 的 "list_slots" op handler 调 runBookerListSlots。tool
// spec / schema 在外置插件 mcp-servers/booker；wire 形态 ({slots:[{start,end}]})
// 不变，frontend SlotsCard 照旧解。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

func runBookerListSlots(
	ctx context.Context, deps *BookerDeps, ci *bookerCallInput, input []byte,
) (string, error) {
	args, derr := decodeListSlotsArgs(input)
	if derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	slots, lerr := ListAvailableSlots(ctx, deps.Proxy, deps.Store, &ListSlotsInput{
		OwnerID: ci.OwnerID, OwnerTZ: ci.OwnerTZ,
		From: args.from, Until: args.until,
		DurationMin: args.DurationMin, StepMin: args.StepMin,
	})
	if lerr != nil {
		// 经统一友好映射（not_connected / calendar_unavailable / …），不把底层
		// 5xx / stack 泄漏给访客。
		return marshalBookErr(lerr), nil
	}
	return marshalListSlotsResult(slots), nil
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

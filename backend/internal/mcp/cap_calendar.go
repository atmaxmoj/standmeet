// cap_calendar.go —— Phase E-14c: owner-side calendar parity Capability。
// 2 tools: calendar.list_slots / calendar.cancel_booking。owner-only。
//
// visitor-side calendar.book 仍走 visitor capreg (capability dotted ID
// "calendar.book")。本 capability 给 owner 在 Claude Code 排时间 / 撤会用。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capCalendarBundle = "calendar.bundle"

// CalendarOwnerStore —— owner 日历工具需要 booking policy/count/create
// (CalendarStore) + booking 行存取 (CancelBookingStore)。凭据/代调走
// CalendarProxy，不在 store 里。
type CalendarOwnerStore interface {
	usecases.CalendarStore
	usecases.CancelBookingStore
}

type calendarCapability struct {
	proxy   usecases.CalendarProxy
	store   CalendarOwnerStore
	ownerTZ OwnerLookup
	log     *slog.Logger
}

func newCalendarCapability(
	proxy usecases.CalendarProxy, store CalendarOwnerStore,
	owners OwnerLookup, log *slog.Logger,
) *calendarCapability {
	return &calendarCapability{proxy: proxy, store: store, ownerTZ: owners, log: log}
}

func (*calendarCapability) ID() string          { return capCalendarBundle }
func (*calendarCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*calendarCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*calendarCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*calendarCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *calendarCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listSlotsBinding(), c.cancelBookingBinding(),
	}
}

// ───── calendar.list_slots ───────────────────────────────────────

func (c *calendarCapability) listSlotsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "calendar.list_slots",
		Description: "Enumerate available [start, end] slots that pass booking policy " +
			"(weekday + working_hours + min_lead_days) AND don't overlap any FreeBusy " +
			"window. Returns up to 50 slots, RFC3339-formatted in UTC.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"from_rfc3339":{"type":"string",
					"description":"Search window start (RFC3339)."},
				"until_rfc3339":{"type":"string",
					"description":"Search window end (RFC3339)."},
				"duration_min":{"type":"number",
					"description":"Slot length in minutes (e.g. 30, 60)."},
				"step_min":{"type":"number",
					"description":"Slot enumeration step in minutes (default 30)."}
			},
			"required":["from_rfc3339","until_rfc3339","duration_min"]
		}`),
		Handler: c.handleListSlots,
	}
}

type listSlotsArgsWire struct {
	From        string `json:"from_rfc3339"`
	Until       string `json:"until_rfc3339"`
	DurationMin int    `json:"duration_min"`
	StepMin     int    `json:"step_min"`
}

func (c *calendarCapability) handleListSlots(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseListSlotsArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	owner, oerr := c.ownerTZ.GetByID(ctx, ownerID)
	if oerr != nil {
		c.log.Error("cap calendar.list_slots owner lookup", "err", oerr)
		return capreg.MCPError("owner not found")
	}
	slots, err := usecases.ListAvailableSlots(ctx, c.proxy, c.store, &usecases.ListSlotsInput{
		OwnerID: ownerID, OwnerTZ: owner.ProfileTimezone,
		From: args.from, Until: args.until,
		DurationMin: args.DurationMin, StepMin: args.StepMin,
	})
	if err != nil {
		return calendarCapErr(c.log, err, "list_slots")
	}
	return marshalCapResult(c.log, "calendar.list_slots",
		map[string]any{"slots": viewSlots(slots)})
}

type listSlotsParsed struct {
	from        time.Time
	until       time.Time
	DurationMin int
	StepMin     int
}

func parseListSlotsArgs(raw json.RawMessage) (listSlotsParsed, error) {
	var args listSlotsArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return listSlotsParsed{}, errors.New("invalid arguments: " + err.Error())
	}
	if vErr := validateListSlotsArgs(&args); vErr != nil {
		return listSlotsParsed{}, vErr
	}
	from, fErr := time.Parse(time.RFC3339, args.From)
	if fErr != nil {
		return listSlotsParsed{}, fmt.Errorf("from_rfc3339 parse: %w", fErr)
	}
	until, uErr := time.Parse(time.RFC3339, args.Until)
	if uErr != nil {
		return listSlotsParsed{}, fmt.Errorf("until_rfc3339 parse: %w", uErr)
	}
	return listSlotsParsed{
		from: from, until: until,
		DurationMin: args.DurationMin, StepMin: args.StepMin,
	}, nil
}

func validateListSlotsArgs(args *listSlotsArgsWire) error {
	if args.From == "" || args.Until == "" {
		return errors.New("from_rfc3339 + until_rfc3339 required")
	}
	if args.DurationMin <= 0 {
		return errors.New("duration_min must be > 0")
	}
	return nil
}

type slotView struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

func viewSlots(slots []usecases.AvailableSlot) []slotView {
	out := make([]slotView, 0, len(slots))
	for i := range slots {
		out = append(out, slotView{
			Start: slots[i].Start.UTC().Format(time.RFC3339),
			End:   slots[i].End.UTC().Format(time.RFC3339),
		})
	}
	return out
}

// ───── calendar.cancel_booking ──────────────────────────────────

func (c *calendarCapability) cancelBookingBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "calendar.cancel_booking",
		Description: "Cancel a persisted booking by id. Deletes the Google Calendar event " +
			"(sendUpdates='all' if visitor_email present) and removes the code_bookings row.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"booking_id":{"type":"string","description":"code_bookings.id"}
			},
			"required":["booking_id"]
		}`),
		Handler: c.handleCancelBooking,
	}
}

type cancelBookingArgsWire struct {
	BookingID string `json:"booking_id"`
}

func (c *calendarCapability) handleCancelBooking(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args cancelBookingArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.BookingID == "" {
		return capreg.MCPError("booking_id is required")
	}
	cancelled, err := usecases.CancelBooking(ctx, c.proxy, c.store, &usecases.CancelBookingInput{
		OwnerID: ownerID, BookingID: args.BookingID,
	})
	if err != nil {
		return calendarCapErr(c.log, err, "cancel_booking")
	}
	return marshalCapResult(c.log, "calendar.cancel_booking", map[string]any{
		"booking_id":      cancelled.BookingID,
		"google_event_id": cancelled.GoogleEvent,
		"summary":         cancelled.Summary,
		"cancelled":       true,
		"sent_updates_to": cancelled.VisitorEmail,
	})
}

// ───── error mapping ────────────────────────────────────────────

func calendarCapErr(log *slog.Logger, err error, op string) capreg.MCPResult {
	switch {
	case errors.Is(err, domain.ErrBookingNotFound):
		return capreg.MCPError("booking not found")
	case errors.Is(err, domain.ErrCalendarNotConnected):
		return capreg.MCPError("calendar connector not connected")
	case errors.Is(err, domain.ErrCalendarRevoked):
		return capreg.MCPError("calendar oauth revoked")
	}
	log.Error("cap calendar."+op, "err", err)
	return capreg.MCPError("calendar." + op + " failed")
}

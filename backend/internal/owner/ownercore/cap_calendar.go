// cap_calendar.go —— Phase E-14c: owner-side calendar parity Capability。
// 2 tools: calendar.list_slots / calendar.cancel_booking。owner-only。
//
// visitor-side calendar.book 仍走 visitor capreg (capability dotted ID
// "calendar.book")。本 capability 给 owner 在 Claude Code 排时间 / 撤会用。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const capCalendarBundle = "calendar.bundle"

// CalendarOwnerStore —— owner 日历工具需要 booking policy/count/create
// (CalendarStore) + booking 行存取 (CancelBookingStore)。凭据/代调走
// CalendarProxy，不在 store 里。
type CalendarOwnerStore interface {
	owner.CalendarStore
	owner.CancelBookingStore
}

type calendarCapability struct {
	proxy   contract.CalendarProxy
	store   CalendarOwnerStore
	ownerTZ OwnerLookup
	log     *slog.Logger
}

func newCalendarCapability(
	proxy contract.CalendarProxy, store CalendarOwnerStore,
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
	// calendar.list_slots 不在这里 —— 它由**沙箱 booker** 经 manifest.OwnerTools 提供
	// (一份算法归能力所有;host 曾经重复实现过策略评估 + slot 枚举)。这里只剩 host 侧
	// 仍自持的 owner 工具。
	return []*capreg.MCPBinding{c.cancelBookingBinding()}
}

// ───── calendar.cancel_booking ──────────────────────────────────

func (c *calendarCapability) cancelBookingBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "calendar.cancel_booking",
		Description: "Cancel a persisted booking by id. Deletes the Google Calendar event " +
			"(sendUpdates='all' if visitor_email present) and removes the stored booking.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"booking_id":{"type":"string","description":"the booking id from list_bookings"}
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
	cancelled, err := owner.CancelBooking(ctx, c.proxy, c.store, &owner.CancelBookingInput{
		OwnerID: ownerID, BookingID: args.BookingID,
	})
	if err != nil {
		return calendarCapErr(c.log, err, "cancel_booking")
	}
	return mcputil.MarshalResult(c.log, "calendar.cancel_booking", map[string]any{
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
	case errors.Is(err, owner.ErrBookingNotFound):
		return capreg.MCPError("booking not found")
	case errors.Is(err, contract.ErrCalendarNotConnected):
		return capreg.MCPError("calendar connector not connected")
	case errors.Is(err, contract.ErrCalendarRevoked):
		return capreg.MCPError("calendar oauth revoked")
	}
	log.Error("cap calendar."+op, "err", err)
	return capreg.MCPError("calendar." + op + " failed")
}

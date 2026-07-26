package ownercore

// cap_booking.go —— owner-side booking-policy + bookings-list Capability. 3
// tools: booking.get_policy (read) / booking.set_policy (action) /
// bookings.list (read). owner-only. Mirrors the admin /api/admin/booking-policy
// GET+PATCH and /api/admin/bookings/ routes over MCP so the owner can inspect
// and tune the scheduling policy (+timezone) and list bookings from Claude Code.
//
// A calendar Capability already exists (cap_calendar.go: list_slots +
// cancel_booking); this is the distinct policy/list surface, with its own narrow
// deps so the two stay decoupled.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/plugins/booker"
)

const capBookingBundle = "booking.bundle"

// bookingsListLimit —— fixed page size, matches the admin /bookings/ route.
const bookingsListLimit = 100

// ───── narrow deps ──────────────────────────────────────────────

// BookingPolicyUpsert —— plain-arg upsert input. The concrete repo
// (*postgres.CalendarRepo.UpsertBookingPolicy) takes a *postgres.UpsertPolicyInput,
// a banned type here, so the wiring adapter converts this into it.
type BookingPolicyUpsert struct {
	OwnerID           string
	WorkingHoursStart string
	WorkingHoursEnd   string
	AllowedWeekdays   []string
	MinLeadDays       int32
	BufferMin         int32
}

// bookingRepo —— policy read/upsert + bookings list. GetBookingPolicy and
// ListBookingsByOwner are satisfied by *postgres.CalendarRepo directly;
// UpsertBookingPolicy uses the plain BookingPolicyUpsert, so an adapter wraps it.
type bookingRepo interface {
	GetBookingPolicy(ctx context.Context, ownerID string) (booker.BookingPolicy, error)
	UpsertBookingPolicy(
		ctx context.Context, in *BookingPolicyUpsert,
	) (booker.BookingPolicy, error)
	ListBookingsByOwner(
		ctx context.Context, ownerID string, limit int32,
	) ([]booker.CodeBooking, error)
}

// bookingOwners —— owner timezone read (GetByID → ProfileTimezone) + write.
// *postgres.OwnerRepo satisfies it directly.
type bookingOwners interface {
	GetByID(ctx context.Context, ownerID string) (ownerdomain.Owner, error)
	UpdateProfileTimezone(ctx context.Context, ownerID, tz string) error
}

// BookingOwnerDeps —— newBookingCapability 入参打包。Repo gives policy + bookings;
// Owners carries the profile timezone (stored on the owner, not the policy row).
type BookingOwnerDeps struct {
	Repo   bookingRepo
	Owners bookingOwners
}

type bookingCapability struct {
	deps *BookingOwnerDeps
	log  *slog.Logger
}

func newBookingCapability(deps *BookingOwnerDeps, log *slog.Logger) *bookingCapability {
	return &bookingCapability{deps: deps, log: log}
}

func (*bookingCapability) ID() string          { return capBookingBundle }
func (*bookingCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*bookingCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*bookingCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*bookingCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *bookingCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.getPolicyBinding(), c.setPolicyBinding(), c.listBookingsBinding(),
	}
}

// ───── booking.get_policy ───────────────────────────────────────

// bookingPolicyView —— MCP wire view: policy fields + the owner's profile
// timezone (which lives on the owner row, not the policy).
type bookingPolicyView struct {
	WorkingHoursStart string   `json:"working_hours_start"`
	WorkingHoursEnd   string   `json:"working_hours_end"`
	Timezone          string   `json:"timezone"`
	AllowedWeekdays   []string `json:"allowed_weekdays"`
	MinLeadDays       int32    `json:"min_lead_days"`
	BufferMin         int32    `json:"buffer_min"`
}

func (c *bookingCapability) getPolicyBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "booking.get_policy",
		Description: "Return the owner's booking policy (working hours, allowed " +
			"weekdays, min lead days, buffer) plus the profile timezone. Read-only.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleGetPolicy,
	}
}

func (c *bookingCapability) handleGetPolicy(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	owner, oerr := c.deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		c.log.Error("cap booking.get_policy owner", "err", oerr)
		return capreg.MCPError("owner not found")
	}
	policy, perr := c.deps.Repo.GetBookingPolicy(ctx, ownerID)
	if perr != nil {
		c.log.Error("cap booking.get_policy", "err", perr)
		return capreg.MCPError("booking.get_policy failed")
	}
	return mcputil.MarshalResult(c.log, "booking.get_policy",
		toBookingPolicyView(&policy, owner.ProfileTimezone))
}

func toBookingPolicyView(p *booker.BookingPolicy, tz string) bookingPolicyView {
	return bookingPolicyView{
		AllowedWeekdays:   p.AllowedWeekdays,
		WorkingHoursStart: p.WorkingHoursStart,
		WorkingHoursEnd:   p.WorkingHoursEnd,
		Timezone:          tz,
		MinLeadDays:       p.MinLeadDays,
		BufferMin:         p.BufferMin,
	}
}

// ───── booking.set_policy ───────────────────────────────────────

// bookingPolicyPatch —— mirrors the admin PATCH body: pointer fields are
// merge-only (nil = leave current value). timezone writes the owner row.
type bookingPolicyPatch struct {
	WorkingHoursStart *string  `json:"working_hours_start,omitempty"`
	WorkingHoursEnd   *string  `json:"working_hours_end,omitempty"`
	Timezone          *string  `json:"timezone,omitempty"`
	MinLeadDays       *int32   `json:"min_lead_days,omitempty"`
	BufferMin         *int32   `json:"buffer_min,omitempty"`
	AllowedWeekdays   []string `json:"allowed_weekdays,omitempty"`
}

func (c *bookingCapability) setPolicyBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "booking.set_policy",
		Description: "Merge-update the booking policy: only the supplied fields " +
			"change. min_lead_days must be >= 1. If timezone is supplied it updates " +
			"the owner's profile timezone.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"working_hours_start":{"type":"string","description":"'HH:MM'."},
				"working_hours_end":{"type":"string","description":"'HH:MM'."},
				"allowed_weekdays":{"type":"array","items":{"type":"string"},
					"description":"e.g. ['mon','tue','wed','thu','fri']."},
				"min_lead_days":{"type":"integer","description":"Positive integer (>= 1)."},
				"buffer_min":{"type":"integer","description":"Buffer minutes between bookings."},
				"timezone":{"type":"string","description":"IANA tz name."}
			}
		}`),
		Handler: c.handleSetPolicy,
	}
}

func parseBookingPolicyPatch(raw json.RawMessage) (bookingPolicyPatch, error) {
	var patch bookingPolicyPatch
	if err := json.Unmarshal(raw, &patch); err != nil {
		return patch, errors.New("invalid arguments: " + err.Error())
	}
	if patch.MinLeadDays != nil && *patch.MinLeadDays < 1 {
		return patch, errors.New("min_lead_days must be a positive integer (>= 1)")
	}
	return patch, nil
}

func (c *bookingCapability) handleSetPolicy(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	patch, perr := parseBookingPolicyPatch(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	if err := c.applyPolicy(ctx, ownerID, &patch); err != nil {
		c.log.Error("cap booking.set_policy", "err", err)
		return capreg.MCPError("booking.set_policy failed")
	}
	return mcputil.MarshalResult(c.log, "booking.set_policy", map[string]any{"ok": true})
}

// applyPolicy —— load current, merge the patch, upsert, then (if supplied) update
// the profile timezone. Wraps every returned repo error for the handler to log.
func (c *bookingCapability) applyPolicy(
	ctx context.Context, ownerID string, patch *bookingPolicyPatch,
) error {
	current, gerr := c.deps.Repo.GetBookingPolicy(ctx, ownerID)
	if gerr != nil {
		return fmt.Errorf("load booking policy: %w", gerr)
	}
	merged := mergeBookingPatch(&current, patch)
	if _, uerr := c.deps.Repo.UpsertBookingPolicy(ctx, &BookingPolicyUpsert{
		AllowedWeekdays:   merged.AllowedWeekdays,
		OwnerID:           ownerID,
		WorkingHoursStart: merged.WorkingHoursStart,
		WorkingHoursEnd:   merged.WorkingHoursEnd,
		MinLeadDays:       merged.MinLeadDays,
		BufferMin:         merged.BufferMin,
	}); uerr != nil {
		return fmt.Errorf("upsert booking policy: %w", uerr)
	}
	if patch.Timezone != nil {
		if terr := c.deps.Owners.UpdateProfileTimezone(ctx, ownerID, *patch.Timezone); terr != nil {
			return fmt.Errorf("update profile timezone: %w", terr)
		}
	}
	return nil
}

func mergeBookingPatch(
	current *booker.BookingPolicy, patch *bookingPolicyPatch,
) *booker.BookingPolicy {
	out := *current
	applyBookingStringFields(&out, patch)
	applyBookingNumericFields(&out, patch)
	if patch.AllowedWeekdays != nil {
		out.AllowedWeekdays = patch.AllowedWeekdays
	}
	return &out
}

func applyBookingStringFields(out *booker.BookingPolicy, patch *bookingPolicyPatch) {
	if patch.WorkingHoursStart != nil {
		out.WorkingHoursStart = *patch.WorkingHoursStart
	}
	if patch.WorkingHoursEnd != nil {
		out.WorkingHoursEnd = *patch.WorkingHoursEnd
	}
}

func applyBookingNumericFields(out *booker.BookingPolicy, patch *bookingPolicyPatch) {
	if patch.MinLeadDays != nil {
		out.MinLeadDays = *patch.MinLeadDays
	}
	if patch.BufferMin != nil {
		out.BufferMin = *patch.BufferMin
	}
}

// ───── bookings.list ────────────────────────────────────────────

// bookingRowView —— MCP wire view of one code_booking (newest-first list).
type bookingRowView struct {
	StartAt        string `json:"start_at"`
	EndAt          string `json:"end_at"`
	CreatedAt      string `json:"created_at"`
	ID             string `json:"id"`
	CodeID         string `json:"code_id"`
	ConversationID string `json:"conversation_id"`
	GoogleEventID  string `json:"google_event_id"`
	GoogleHTMLLink string `json:"google_html_link"`
	Summary        string `json:"summary"`
	VisitorEmail   string `json:"visitor_email,omitempty"`
}

func (c *bookingCapability) listBookingsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "bookings.list",
		Description: "List the owner's bookings, newest first (up to 100). Each row " +
			"carries the code + conversation ids, Google event id/link, summary, and " +
			"start/end/created timestamps (RFC3339 UTC). Read-only.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleListBookings,
	}
}

func (c *bookingCapability) handleListBookings(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := c.deps.Repo.ListBookingsByOwner(ctx, ownerID, bookingsListLimit)
	if err != nil {
		c.log.Error("cap bookings.list", "err", err)
		return capreg.MCPError("bookings.list failed")
	}
	return mcputil.MarshalResult(c.log, "bookings.list", bookingRowViews(rows))
}

func bookingRowViews(rows []booker.CodeBooking) []bookingRowView {
	out := make([]bookingRowView, 0, len(rows))
	for i := range rows {
		out = append(out, toBookingRowView(&rows[i]))
	}
	return out
}

func toBookingRowView(b *booker.CodeBooking) bookingRowView {
	return bookingRowView{
		ID: b.ID, CodeID: b.CodeID, ConversationID: b.ConversationID,
		GoogleEventID: b.GoogleEventID, GoogleHTMLLink: b.GoogleHTMLLink,
		Summary: b.Summary, VisitorEmail: b.VisitorEmail,
		StartAt:   b.StartAt.UTC().Format(time.RFC3339),
		EndAt:     b.EndAt.UTC().Format(time.RFC3339),
		CreatedAt: b.CreatedAt.UTC().Format(time.RFC3339),
	}
}

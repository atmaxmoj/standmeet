// booking_policy.go —— /api/admin/booking-policy GET + PATCH.
// Singleton per owner. PATCH 全量 set，没 set 的字段不允许漏（前端先 GET
// 拿当前值，做 spread 再 PATCH）。

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// MountBookingPolicy —— /booking-policy GET + PATCH 挂载。
func (h *Handlers) MountBookingPolicy(r chi.Router) {
	r.Get("/booking-policy", h.getBookingPolicy())
	r.Patch("/booking-policy", h.setBookingPolicy())
}

type policyView struct {
	WorkingHoursStart string   `json:"working_hours_start"`
	WorkingHoursEnd   string   `json:"working_hours_end"`
	Timezone          string   `json:"timezone"`
	AllowedWeekdays   []string `json:"allowed_weekdays"`
	MinLeadDays       int32    `json:"min_lead_days"`
	BufferMin         int32    `json:"buffer_min"`
}

type policyPatchRequest struct {
	WorkingHoursStart *string  `json:"working_hours_start,omitempty"`
	WorkingHoursEnd   *string  `json:"working_hours_end,omitempty"`
	Timezone          *string  `json:"timezone,omitempty"`
	MinLeadDays       *int32   `json:"min_lead_days,omitempty"`
	BufferMin         *int32   `json:"buffer_min,omitempty"`
	AllowedWeekdays   []string `json:"allowed_weekdays,omitempty"`
}

func (h *Handlers) getBookingPolicy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		prof, oerr := h.AccountAdmin.Account.Owners.GetByID(r.Context(), ownerID)
		if oerr != nil {
			h.Log.Error("get owner for policy", "err", oerr)
			writeError(h.Log, w, serverErr())
			return
		}
		policy, perr := h.CalendarAdmin.Policy.Get(r.Context(), ownerID)
		if perr != nil {
			h.Log.Error("get booking policy", "err", perr)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, toPolicyView(&policy, prof.ProfileTimezone))
	}
}

func toPolicyView(p *owner.BookingPolicy, tz string) policyView {
	return policyView{
		WorkingHoursStart: p.WorkingHoursStart,
		WorkingHoursEnd:   p.WorkingHoursEnd,
		AllowedWeekdays:   p.AllowedWeekdays,
		MinLeadDays:       p.MinLeadDays,
		BufferMin:         p.BufferMin,
		Timezone:          tz,
	}
}

func (h *Handlers) setBookingPolicy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var patch policyPatchRequest
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runSetBookingPolicy(r, h, w, &patch)
	}
}

func runSetBookingPolicy(
	r *http.Request, h *Handlers, w http.ResponseWriter, patch *policyPatchRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	if !applyPolicyPatch(r, h, w, ownerID, patch) {
		return
	}
	if patch.Timezone != nil {
		applyTimezoneUpdate(r, h, w, ownerID, *patch.Timezone)
		return
	}
	writeJSON(h.Log, w, map[string]bool{"ok": true})
}

// applyPolicyPatch —— 校验 + upsert 合一,让 handler (runSetBookingPolicy) 守
// routes-cyclo ≤3。返 false = 已写错误响应、caller 收手。
func applyPolicyPatch(
	r *http.Request, h *Handlers, w http.ResponseWriter,
	ownerID string, patch *policyPatchRequest,
) bool {
	if !validatePolicyPatch(h, w, patch) {
		return false
	}
	return upsertPolicyFromPatch(r, h, w, ownerID, patch)
}

// validatePolicyPatch —— min_lead_days 必须正整数 (≥1)。恒正才能保证 booking
// 永远落在未来 (杜绝过去时段)。返 false = 已写 400、caller 收手。
func validatePolicyPatch(h *Handlers, w http.ResponseWriter, patch *policyPatchRequest) bool {
	if patch.MinLeadDays != nil && *patch.MinLeadDays < 1 {
		writeError(h.Log, w, envBadReq("min_lead_days must be a positive integer (>= 1)"))
		return false
	}
	return true
}

func upsertPolicyFromPatch(
	r *http.Request, h *Handlers, w http.ResponseWriter,
	ownerID string, patch *policyPatchRequest,
) bool {
	current, gerr := h.CalendarAdmin.Policy.Get(r.Context(), ownerID)
	if gerr != nil {
		h.Log.Error("load policy for patch", "err", gerr)
		writeError(h.Log, w, serverErr())
		return false
	}
	merged := mergePolicyPatch(&current, patch)
	if uerr := h.CalendarAdmin.Policy.Set(r.Context(), ownerID, merged); uerr != nil {
		h.Log.Error("upsert booking policy", "err", uerr)
		writeError(h.Log, w, serverErr())
		return false
	}
	return true
}

func mergePolicyPatch(
	current *owner.BookingPolicy, patch *policyPatchRequest,
) *owner.BookingPolicy {
	out := *current
	applyStringPolicyFields(&out, patch)
	applyNumericPolicyFields(&out, patch)
	if patch.AllowedWeekdays != nil {
		out.AllowedWeekdays = patch.AllowedWeekdays
	}
	return &out
}

func applyStringPolicyFields(out *owner.BookingPolicy, patch *policyPatchRequest) {
	if patch.WorkingHoursStart != nil {
		out.WorkingHoursStart = *patch.WorkingHoursStart
	}
	if patch.WorkingHoursEnd != nil {
		out.WorkingHoursEnd = *patch.WorkingHoursEnd
	}
}

func applyNumericPolicyFields(out *owner.BookingPolicy, patch *policyPatchRequest) {
	if patch.MinLeadDays != nil {
		out.MinLeadDays = *patch.MinLeadDays
	}
	if patch.BufferMin != nil {
		out.BufferMin = *patch.BufferMin
	}
}

func applyTimezoneUpdate(
	r *http.Request, h *Handlers, w http.ResponseWriter, ownerID, tz string,
) {
	owners := h.AccountAdmin.Account.Owners
	if err := owners.UpdateProfileTimezone(r.Context(), ownerID, tz); err != nil {
		h.Log.Error("update profile timezone", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	writeJSON(h.Log, w, map[string]bool{"ok": true})
}

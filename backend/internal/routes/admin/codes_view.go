// codes_view.go —— access-code 列表的 view 映射(accessdomain.AccessCode → codeView)。
// #135:MaxBookings 不在内核 code 上,列表展示时从 booker 能力读(readCodeBookingQuota)。

package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/accessdomain"
)

func writeCodesList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []accessdomain.AccessCode,
) {
	items := make([]codeView, 0, len(rows))
	for i := range rows {
		items = append(items, toCodeView(r.Context(), h, &rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode codes", err)
	}
}

func toCodeView(ctx context.Context, h *Handlers, c *accessdomain.AccessCode) codeView {
	return codeView{
		ID:                   c.ID,
		Code:                 c.Code,
		Label:                c.Label,
		Status:               c.Status,
		Ghosts:               c.Ghosts,
		CreatedAt:            c.CreatedAt.Format(time.RFC3339),
		ExpiresAt:            rfc3339OrNil(c.ExpiresAt),
		MaxMembers:           c.MaxMembers,
		MaxTurnsPerSession:   c.MaxTurnsPerSession,
		MaxBookings:          readCodeBookingQuota(ctx, h.CodesAdmin.Booking, h.Log, c.ID),
		RequireGhostEvidence: c.RequireGhostEvidence,
		AssumedRoleID:        c.AssumedRoleID,
		PromptID:             c.PromptID,
	}
}

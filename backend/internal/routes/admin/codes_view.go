// codes_view.go —— access-code 列表的 view 映射(domain.AccessCode → codeView)。
// #135 后续:MaxBookings 从 booker 读(现仍双写 access_code 列,drain 收尾时改成 Booking.MaxBookingsOf)。

package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func writeCodesList(
	_ *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.AccessCode,
) {
	items := make([]codeView, 0, len(rows))
	for i := range rows {
		items = append(items, toCodeView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode codes", err)
	}
}

func toCodeView(c *domain.AccessCode) codeView {
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
		MaxBookings:          c.MaxBookings,
		RequireGhostEvidence: c.RequireGhostEvidence,
		AssumedRoleID:        c.AssumedRoleID,
		PromptID:             c.PromptID,
	}
}

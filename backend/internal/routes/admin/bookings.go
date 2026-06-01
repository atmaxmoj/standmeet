// bookings.go —— /api/admin/bookings/ list endpoint (E-14c)。给 admin UI
// 也给 e2e 验 calendar.cancel_booking 拿 booking_id 用。
//
// 仅 GET (list)；create 走 visitor.calendar_book，delete 走 owner MCP
// calendar.cancel_booking。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
)

const adminBookingsLimit = 100

// MountBookings —— /bookings/ GET 挂载。
func (h *Handlers) MountBookings(r chi.Router) {
	r.Get("/bookings/", h.listBookings())
}

type bookingView struct {
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

func (h *Handlers) listBookings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.CalendarAdmin.Repo.ListBookingsByOwner(
			r.Context(), ownerID, adminBookingsLimit,
		)
		if err != nil {
			logEncodeErr(h.Log, "list bookings", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeBookingsList(h.Log, w, rows)
	}
}

func writeBookingsList(log *slog.Logger, w http.ResponseWriter, rows []domain.CodeBooking) {
	out := make([]bookingView, 0, len(rows))
	for i := range rows {
		out = append(out, toBookingView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(out); err != nil {
		log.Warn("write bookings list", "err", err)
	}
}

func toBookingView(b *domain.CodeBooking) bookingView {
	return bookingView{
		ID: b.ID, CodeID: b.CodeID, ConversationID: b.ConversationID,
		GoogleEventID: b.GoogleEventID, GoogleHTMLLink: b.GoogleHTMLLink,
		Summary: b.Summary, VisitorEmail: b.VisitorEmail,
		StartAt:   b.StartAt.UTC().Format("2006-01-02T15:04:05Z"),
		EndAt:     b.EndAt.UTC().Format("2006-01-02T15:04:05Z"),
		CreatedAt: b.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

// test_tool_specs.go —— GET /internal/test/visitor-tool-specs
//
// 仅 e2e fixture 用：给一个 visitor session token (X-Session-Token header)，
// 返回 backend 当前会装配给这个 session 的 tool spec 列表。让 spec assert
// "calendar.book 是否暴露给这个 session" 而无需实际跑一轮 chat。
//
// 路径在 /internal 下不带任何 auth；token 就是 capability。

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// TestToolSpecsDeps —— deps for the /test/visitor-tool-specs endpoint.
type TestToolSpecsDeps struct {
	Sessions *session.VisitorSessionStore
	Visitor  *usecases.VisitorDeps
	Log      *slog.Logger
}

// MountTestToolSpecs —— mount under /internal.
func MountTestToolSpecs(r chi.Router, deps TestToolSpecsDeps) {
	r.Get("/test/visitor-tool-specs", testToolSpecsHandler(deps))
}

type toolSpecResp struct {
	Tools []toolSpecWire `json:"tools"`
}

type toolSpecWire struct {
	Name string `json:"name"`
}

func testToolSpecsHandler(deps TestToolSpecsDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Session-Token")
		if token == "" {
			http.Error(w, "missing X-Session-Token", http.StatusBadRequest)
			return
		}
		data, err := deps.Sessions.Get(r.Context(), token)
		if err != nil {
			writeTestErr(w, err)
			return
		}
		writeToolSpecs(r.Context(), deps, w, &data)
	}
}

func writeToolSpecs(
	ctx context.Context, deps TestToolSpecsDeps,
	w http.ResponseWriter, data *session.VisitorSessionData,
) {
	names := usecases.AssembleVisitorToolNames(ctx, deps.Visitor, &usecases.SendMessageInput{
		OwnerID:        data.OwnerID,
		Mode:           data.Mode,
		CodeID:         data.CodeID,
		MaxBookings:    data.MaxBookings,
		RoleSnapshot:   data.RoleSnapshot,
		ConversationID: "", // not needed for spec assembly
		Body:           "",
	})
	resp := toolSpecResp{Tools: make([]toolSpecWire, 0, len(names))}
	for _, n := range names {
		resp.Tools = append(resp.Tools, toolSpecWire{Name: n})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if eerr := json.NewEncoder(w).Encode(resp); eerr != nil {
		deps.Log.Error("encode tool specs", "err", eerr)
	}
}

func writeTestErr(w http.ResponseWriter, err error) {
	if errors.Is(err, session.ErrVisitorSessionNotFound) {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	http.Error(w, "internal: "+err.Error(), http.StatusInternalServerError)
}

// unused import guard (domain referenced by AssembleVisitorToolNames).
var _ = domain.CalendarProvider

// gcal.go —— mock Google OAuth + Calendar API + FreeBusy endpoints, plus
// /__mock/gcal/* control endpoints e2e specs use to seed busy fixtures
// and inspect inserted events. State is process-local + guarded; tests
// reset between cases via POST /__mock/gcal/reset.

package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
)

const (
	mockAccessTokenLen  = 8 // hex chars per access token issuance
	mockEventIDLen      = 12
	defaultExpiresIn    = 3600 // seconds
	mockScope           = "https://www.googleapis.com/auth/calendar"
	scopeOAuthTokenType = "Bearer"
	logErrKey           = "err"
)

// busyWindow / mockEvent —— in-memory state types.

type busyWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type attendee struct {
	Email string `json:"email"`
}

type eventTime struct {
	DateTime string `json:"dateTime"`
}

type mockEvent struct {
	EventID     string     `json:"event_id"`
	Summary     string     `json:"summary"`
	Description string     `json:"description,omitempty"`
	SendUpdates string     `json:"send_updates,omitempty"`
	Start       eventTime  `json:"start"`
	End         eventTime  `json:"end"`
	Attendees   []attendee `json:"attendees,omitempty"`
}

type gcalState struct {
	busy           []busyWindow
	events         []mockEvent
	tokenCallCount int
	mu             sync.Mutex
}

// withState —— defer-friendly mutex helper. Used by every handler.
func (s *server) withState(f func(*gcalState)) {
	s.gcal.mu.Lock()
	defer s.gcal.mu.Unlock()
	f(&s.gcal)
}

// ─── /google-oauth/auth ────────────────────────────────────────

// serveOAuthAuth —— 302 to the redirect_uri carrying a synthesized code +
// echoed state. Mock skips the user-consent screen.
//
// gosec flags the user-supplied redirect_uri as an open-redirect risk —
// which is exactly the contract of a test-only mock OAuth server, so
// we silence it here. This binary is never deployed; it only runs in
// docker-compose for dev/e2e.
func (*server) serveOAuthAuth(w http.ResponseWriter, r *http.Request) {
	redirect := r.URL.Query().Get("redirect_uri")
	state := r.URL.Query().Get("state")
	if redirect == "" {
		http.Error(w, "missing redirect_uri", http.StatusBadRequest)
		return
	}
	u, err := url.Parse(redirect)
	if err != nil {
		http.Error(w, "bad redirect_uri", http.StatusBadRequest)
		return
	}
	q := u.Query()
	q.Set("code", "mock-auth-code-"+randomHex(mockAccessTokenLen))
	q.Set("state", state)
	u.RawQuery = q.Encode()
	//nolint:gosec // G710 — mock server's whole purpose is echoing back the redirect_uri unmodified
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// ─── /google-oauth/token ───────────────────────────────────────

type oauthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

// serveOAuthToken —— form-encoded body; supports both authorization_code
// (issues access + refresh) and refresh_token (issues new access only).
func (s *server) serveOAuthToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	grant := r.PostForm.Get("grant_type")
	resp := oauthTokenResponse{
		AccessToken: "mock-access-" + randomHex(mockAccessTokenLen),
		Scope:       mockScope,
		TokenType:   scopeOAuthTokenType,
		ExpiresIn:   defaultExpiresIn,
	}
	if grant == "authorization_code" {
		resp.RefreshToken = "mock-refresh-" + randomHex(mockAccessTokenLen)
	}
	s.withState(func(st *gcalState) { st.tokenCallCount++ })
	writeOAuthToken(s.log, w, resp)
}

// ─── /google-calendar/calendars/{calendarId}/events ────────────

type insertEventRequest struct {
	Summary     string     `json:"summary"`
	Description string     `json:"description"`
	Start       eventTime  `json:"start"`
	End         eventTime  `json:"end"`
	Attendees   []attendee `json:"attendees"`
}

type insertEventResponse struct {
	ID        string     `json:"id"`
	HTMLLink  string     `json:"htmlLink"`
	Status    string     `json:"status"`
	Summary   string     `json:"summary"`
	Start     eventTime  `json:"start"`
	End       eventTime  `json:"end"`
	Attendees []attendee `json:"attendees,omitempty"`
}

func (s *server) serveCalendarEventsInsert(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req insertEventRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	id := "evt-" + randomHex(mockEventIDLen)
	resp := insertEventResponse{
		ID:        id,
		HTMLLink:  "https://calendar.google.com/event?eid=" + id,
		Status:    "confirmed",
		Summary:   req.Summary,
		Start:     req.Start,
		End:       req.End,
		Attendees: req.Attendees,
	}
	s.withState(func(st *gcalState) {
		st.events = append(st.events, mockEvent{
			EventID:     id,
			Summary:     req.Summary,
			Description: req.Description,
			Start:       req.Start,
			End:         req.End,
			Attendees:   req.Attendees,
			SendUpdates: r.URL.Query().Get("sendUpdates"),
		})
	})
	writeInsertEvent(s.log, w, &resp)
}

// ─── /google-calendar/freeBusy ─────────────────────────────────

type freeBusyRequest struct {
	TimeMin  string              `json:"timeMin"`
	TimeMax  string              `json:"timeMax"`
	TimeZone string              `json:"timeZone,omitempty"`
	Items    []map[string]string `json:"items"`
}

type freeBusyResponse struct {
	Calendars map[string]freeBusyCalendarSpan `json:"calendars"`
	Kind      string                          `json:"kind"`
	TimeMin   string                          `json:"timeMin"`
	TimeMax   string                          `json:"timeMax"`
}

type freeBusyCalendarSpan struct {
	Busy []busyWindow `json:"busy"`
}

func (s *server) serveCalendarFreeBusy(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req freeBusyRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	var busy []busyWindow
	s.withState(func(st *gcalState) { busy = append(busy, st.busy...) })
	writeFreeBusy(s.log, w, freeBusyResponse{
		Kind: "calendar#freeBusy", TimeMin: req.TimeMin, TimeMax: req.TimeMax,
		Calendars: buildFreeBusyCalendars(req.Items, busy),
	})
}

// buildFreeBusyCalendars —— echo every calendar id the caller asked about
// with the single in-state busy fixture. The mock owns one calendar of
// state regardless of how many ids the caller queries.
func buildFreeBusyCalendars(
	items []map[string]string, busy []busyWindow,
) map[string]freeBusyCalendarSpan {
	cal := freeBusyCalendarSpan{Busy: busy}
	out := map[string]freeBusyCalendarSpan{"primary": cal}
	for _, item := range items {
		if id, ok := item["id"]; ok && id != "primary" {
			out[id] = cal
		}
	}
	return out
}

// ─── /__mock/gcal/* control endpoints ──────────────────────────

type setBusyRequest struct {
	Busy []busyWindow `json:"busy"`
}

func (s *server) serveMockSetBusy(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req setBusyRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.withState(func(st *gcalState) { st.busy = req.Busy })
	writeOK(s.log, w)
}

func (s *server) serveMockGCalReset(w http.ResponseWriter, _ *http.Request) {
	s.withState(func(st *gcalState) {
		st.busy = nil
		st.events = nil
		st.tokenCallCount = 0
	})
	writeOK(s.log, w)
}

type eventsResponse struct {
	Events []mockEvent `json:"events"`
}

func (s *server) serveMockGCalEvents(w http.ResponseWriter, _ *http.Request) {
	out := []mockEvent{}
	s.withState(func(st *gcalState) { out = append(out, st.events...) })
	writeEventsList(s.log, w, eventsResponse{Events: out})
}

type tokenCountResponse struct {
	Count int `json:"count"`
}

func (s *server) serveMockGCalTokenCount(w http.ResponseWriter, _ *http.Request) {
	var n int
	s.withState(func(st *gcalState) { n = st.tokenCallCount })
	writeTokenCount(s.log, w, tokenCountResponse{Count: n})
}

// ─── shared helpers ────────────────────────────────────────────

// writeJSONHeader —— shared body-less prelude. Per-type writers below
// call this then encode their typed value; keeps the encoder typed
// (no `any` param the forbidigo linter rejects).
func writeJSONHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusOK)
}

func writeOAuthToken(log *slog.Logger, w http.ResponseWriter, resp oauthTokenResponse) {
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Warn("write oauth token", logErrKey, err)
	}
}

func writeInsertEvent(log *slog.Logger, w http.ResponseWriter, resp *insertEventResponse) {
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Warn("write event insert", logErrKey, err)
	}
}

func writeFreeBusy(log *slog.Logger, w http.ResponseWriter, resp freeBusyResponse) {
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Warn("write freebusy", logErrKey, err)
	}
}

func writeEventsList(log *slog.Logger, w http.ResponseWriter, resp eventsResponse) {
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Warn("write events list", logErrKey, err)
	}
}

func writeTokenCount(log *slog.Logger, w http.ResponseWriter, resp tokenCountResponse) {
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Warn("write token count", logErrKey, err)
	}
}

func writeOK(log *slog.Logger, w http.ResponseWriter) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(`{"ok":true}`)); err != nil {
		log.Warn("write ok", logErrKey, err)
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "0000000000000000"[:n]
	}
	return hex.EncodeToString(b)
}

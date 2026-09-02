// gcal.go —— mock Google OAuth + Calendar API + FreeBusy endpoints, plus
// /__mock/gcal/* control endpoints e2e specs use to seed busy fixtures
// and inspect inserted events. State is process-local + guarded; tests
// reset between cases via POST /__mock/gcal/reset.

package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
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
	deletedEvents  []mockEvent
	fails          map[string]*failInjection // op → injected failure (retry-matrix e2e)
	freeBusyRaw    []byte                    // set_freebusy_raw: the next freeBusy call echoes this back verbatim (one-shot)
	eventShape     string                    // set_event_shape: "" | "object" | "array" (response shape)
	oauthOutcome   string                    // /__mock/oauth/program: ""|deny|token_invalid_client|state_mismatch|network_fail|refresh_omit_scope
	lastAuthScopes map[string][]string       // client_id → the scope subset received on the last authorize call (isolated per client_id: parallel oauth tests each read their own dance, without polluting a shared record)
	// lastChallenge —— client_id → the `code_challenge` (PKCE) carried by the last authorize
	// call. Recorded so the token-exchange step can verify it: no token is issued if the
	// verifier's S256 digest doesn't match. This mock used to **ask nothing at all** about
	// PKCE, so whether the product sent it or not looked equally green (F-C-44).
	lastChallenge  map[string]string
	tokenCallCount int
	revoked        bool // owner revoked at Google → next refresh returns invalid_grant
	mu             sync.Mutex
}

// failInjection —— an e2e control point: makes the next N calls to some op ("freeBusy" /
// "events.insert") fail, to verify the connector's retry layer. remaining: >0 = calls still
// to fail; -1 = fail forever.
// mode "connreset-after-write" (insert only): writes the (idempotency-keyed) event into state
// and then breaks the connection, simulating "response lost after the write went through" ——
// a retry resending the same id then hits the already-stored event, verifying no double-booking.
type failInjection struct {
	mode      string
	status    int
	remaining int
}

// takeFail —— whether this call to op should fail, and how. On a hit, decrements remaining
// (-1 stays unchanged). Caller holds s.gcal.mu.
func (st *gcalState) takeFail(op string) (*failInjection, bool) {
	f, ok := st.fails[op]
	if !ok || f.remaining == 0 {
		return nil, false
	}
	hit := *f
	if f.remaining > 0 {
		f.remaining--
	}
	return &hit, true
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
func (s *server) serveOAuthAuth(w http.ResponseWriter, r *http.Request) {
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
	var outcome string
	clientID := r.URL.Query().Get("client_id")
	s.withState(func(st *gcalState) {
		outcome = st.oauthOutcome
		if st.lastAuthScopes == nil {
			st.lastAuthScopes = map[string][]string{}
		}
		st.lastAuthScopes[clientID] = splitScopes(r.URL.Query().Get("scope"))
		if st.lastChallenge == nil {
			st.lastChallenge = map[string]string{}
		}
		st.lastChallenge[clientID] = r.URL.Query().Get("code_challenge")
	})
	u.RawQuery = authorizeCallbackQuery(outcome, state).Encode()
	//nolint:gosec // G710 — mock server's whole purpose is echoing back the redirect_uri unmodified
	http.Redirect(w, r, u.String(), http.StatusFound)
}

// authorizeCallbackQuery —— builds the callback query from the programmed outcome: deny →
// return only an error; state_mismatch → return a state that doesn't match (verifies the
// backend rejects CSRF); otherwise a normal code+state.
func authorizeCallbackQuery(outcome, state string) url.Values {
	q := url.Values{}
	if outcome == "deny" {
		q.Set("error", "access_denied")
		q.Set("state", state)
		return q
	}
	q.Set("code", "mock-auth-code-"+randomHex(mockAccessTokenLen))
	if outcome == "state_mismatch" {
		q.Set("state", "WRONG-"+state)
		return q
	}
	q.Set("state", state)
	return q
}

// pkceOK —— whether this token exchange's PKCE is correct.
//
// No challenge recorded (this client never went through authorize, or never sent one at all)
// → allow it: that case belongs to a separate guard asserting "does the authorize URL carry
// a challenge," and rejecting unconditionally here would fail every older test case at once,
// the gate blocking off cases it has no business gating
// ([[gate-scope-forces-architecture]]).
// If a challenge was recorded, it must be verified: S256(verifier) has to match challenge
// exactly.
func (s *server) pkceOK(r *http.Request) bool {
	clientID := r.PostForm.Get("client_id")
	var challenge string
	s.withState(func(st *gcalState) { challenge = st.lastChallenge[clientID] })
	if challenge == "" {
		return true
	}
	verifier := r.PostForm.Get("code_verifier")
	if verifier == "" {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:]) == challenge
}

// splitScopes —— the OAuth scope param (space-separated) → a list (empty → an empty slice).
func splitScopes(scope string) []string {
	if scope == "" {
		return []string{}
	}
	return strings.Fields(scope)
}

// grantedScopeFor —— the `scope` in the token response: **the range actually granted this
// time**.
//
// A real provider (Google included) echoes back the scope granted on that authorization in
// the token response —— that's the sole authoritative source for "what permission did I
// actually get," and it's exactly what the product stores as the granted range. This mock
// used to unconditionally return a constant, which was politer than the real world: no
// matter what the owner checked, it always said "you got calendar." So whether the checked
// subset could be read back was something this mock could never expose true or false on
// (F-C-33).
//
// Now it follows the real provider's rule: echo back the scope this client received at the
// authorize step. No record (never went through authorize, e.g. a direct refresh) → fall
// back to the constant, same behavior as before.
func (s *server) grantedScopeFor(clientID string) string {
	var got []string
	s.withState(func(st *gcalState) { got = st.lastAuthScopes[clientID] })
	if len(got) == 0 {
		return mockScope
	}
	return strings.Join(got, " ")
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
	var (
		revoked bool
		fault   *failInjection
		outcome string
	)
	s.withState(func(st *gcalState) {
		st.tokenCallCount++
		revoked = st.revoked
		outcome = st.oauthOutcome
		if grant == "refresh_token" {
			fault, _ = st.takeFail("token")
		}
	})
	// Programmed connection-flow token faults (during the authorization_code exchange):
	// bad client → invalid_client; network_fail → connection dropped.
	if outcome == "token_invalid_client" {
		http.Error(w, `{"error":"invalid_client"}`, http.StatusBadRequest)
		return
	}
	if outcome == "network_fail" {
		s.hijackClose(w)
		return
	}
	// owner revoked at Google → refresh-token grant fails with invalid_grant
	// (the backend maps this to ErrCalendarRevoked → friendly degrade).
	if grant == "refresh_token" && revoked {
		writeInvalidGrant(s.log, w)
		return
	}
	// E7: injected network/500 fault on refresh (NOT invalid_grant) → backend
	// treats it as transient (retry + friendly degrade), not as a revoke.
	if fault != nil {
		if fault.mode == "network" {
			s.hijackClose(w)
			return
		}
		http.Error(w, `{"error":"server_error"}`, fault.status)
		return
	}
	// PKCE: if the authorize step carried a challenge, the token exchange must carry a
	// matching verifier. A real provider (Google, for installed apps) does exactly this;
	// this mock used to not ask, so whether the product actually sent PKCE could never
	// be told apart on it (F-C-44).
	if grant == "authorization_code" && !s.pkceOK(r) {
		writeInvalidGrant(s.log, w)
		return
	}
	resp := oauthTokenResponse{
		AccessToken: "mock-access-" + randomHex(mockAccessTokenLen),
		Scope:       s.grantedScopeFor(r.PostForm.Get("client_id")),
		TokenType:   scopeOAuthTokenType,
		ExpiresIn:   defaultExpiresIn,
	}
	// refresh_omit_scope —— **the refresh response carries no `scope`**, which RFC 6749
	// §5.1 explicitly permits (it may be omitted when the range is unchanged), and is what
	// quite a few providers actually do. Google echoes it, so this path can never be
	// reached against the real environment —— and the stand-in kept being politer than the
	// spec, so the product was never asked "what do you treat the granted range as when it's
	// omitted" ([[stand-in-is-politer-than-reality]]).
	if grant == "refresh_token" && outcome == "refresh_omit_scope" {
		resp.Scope = ""
	}
	if grant == "authorization_code" {
		resp.RefreshToken = "mock-refresh-" + randomHex(mockAccessTokenLen)
	}
	writeOAuthToken(s.log, w, resp)
}

// ─── /google-calendar/calendars/{calendarId}/events ────────────

type insertEventRequest struct {
	ID          string     `json:"id"` // client idempotency key (optional)
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
	var revoked bool
	s.withState(func(st *gcalState) { revoked = st.revoked })
	if revoked { // externally revoked → access token rejected (401) → backend refresh hits invalid_grant → degrades
		writeCalendarUnauthorized(s.log, w)
		return
	}
	ev := mockEvent{
		EventID:     eventID(req.ID),
		Summary:     req.Summary,
		Description: req.Description,
		Start:       req.Start,
		End:         req.End,
		Attendees:   req.Attendees,
		SendUpdates: r.URL.Query().Get("sendUpdates"),
	}
	existing, fail := s.insertDecision(ev)
	var shape string
	s.withState(func(st *gcalState) { shape = st.eventShape })
	switch {
	case existing != nil: // idempotent replay: same id already stored
		s.writeInsertShaped(w, eventToInsertResp(existing), shape)
	case fail != nil:
		s.applyInsertFail(w, fail)
	default:
		s.writeInsertShaped(w, eventToInsertResp(&ev), shape)
	}
}

// writeInsertShaped —— normally returns an object; returns [obj] when set_event_shape=array
// (verifies the binding response extraction handles a "shape mismatch": either normalize it
// or reject it, never crash).
func (s *server) writeInsertShaped(w http.ResponseWriter, resp *insertEventResponse, shape string) {
	if shape == "array" {
		w.Header().Set("Content-Type", "application/json")
		// An explicit array (≥2 elements) → evaluating it yields a sequence that can't fit
		// into a scalar contract field, and the backend degrades gracefully.
		if err := json.NewEncoder(w).Encode([]*insertEventResponse{resp, resp}); err != nil {
			s.log.Error("encode insert array", "err", err)
		}
		return
	}
	writeInsertEvent(s.log, w, resp)
}

const connResetAfterWrite = "connreset-after-write"

// eventID —— uses the client's idempotency key as the event id; the mock assigns one itself
// when empty.
func eventID(key string) string {
	if key != "" {
		return key
	}
	return "evt-" + randomHex(mockEventIDLen)
}

// insertDecision —— decides where an insert ends up and completes the state write, inside
// the lock. Returns (existing, fail):
//
//	existing != nil → same id already stored (idempotent replay), no duplicate write;
//	fail != nil      → injected failure (connreset mode has already written the event into
//	                   state, simulating "the response was lost after the write");
//	both nil         → a normal new insert (already appended).
func (s *server) insertDecision(ev mockEvent) (*mockEvent, *failInjection) {
	var existing, fail = (*mockEvent)(nil), (*failInjection)(nil)
	s.withState(func(st *gcalState) {
		if e := st.findEvent(ev.EventID); e != nil {
			existing = e
			return
		}
		if f, ok := st.takeFail("events.insert"); ok {
			fail = f
			if f.mode == connResetAfterWrite {
				st.events = append(st.events, ev)
			}
			return
		}
		st.events = append(st.events, ev)
	})
	return existing, fail
}

// applyInsertFail —— connreset mode hijacks the connection and drops it outright (the client
// gets a transport error → treated as transient → retries); other modes return the injected
// status code.
func (s *server) applyInsertFail(w http.ResponseWriter, fail *failInjection) {
	if fail.mode == connResetAfterWrite {
		s.hijackClose(w)
		return
	}
	http.Error(w, `{"error":"injected insert failure"}`, fail.status)
}

// findEvent —— finds an already-stored event by id (idempotency dedup). Caller holds the lock.
func (st *gcalState) findEvent(id string) *mockEvent {
	for i := range st.events {
		if st.events[i].EventID == id {
			return &st.events[i]
		}
	}
	return nil
}

func eventToInsertResp(e *mockEvent) *insertEventResponse {
	return &insertEventResponse{
		ID:        e.EventID,
		HTMLLink:  "https://calendar.google.com/event?eid=" + e.EventID,
		Status:    "confirmed",
		Summary:   e.Summary,
		Start:     e.Start,
		End:       e.End,
		Attendees: e.Attendees,
	}
}

// The Events.delete handler is split out into gcal_delete.go to stay under max-lines.

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
	var (
		busy    []busyWindow
		fail    *failInjection
		revoked bool
		raw     []byte
	)
	s.withState(func(st *gcalState) {
		revoked = st.revoked
		if revoked {
			return
		}
		if st.freeBusyRaw != nil { // one-shot: echo this exact JSON blob back (verifies the binding normalizes malformed/missing fields)
			raw, st.freeBusyRaw = st.freeBusyRaw, nil
			return
		}
		if f, ok := st.takeFail("freeBusy"); ok {
			fail = f
			return
		}
		busy = append(busy, st.busy...)
	})
	if revoked { // once externally revoked, access token gets rejected (401) → backend refresh hits invalid_grant → degrades
		writeCalendarUnauthorized(s.log, w)
		return
	}
	if raw != nil {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
		return
	}
	if fail != nil {
		http.Error(w, `{"error":"injected freeBusy failure"}`, fail.status)
		return
	}
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

type setFreeBusyRawRequest struct {
	Body json.RawMessage `json:"body"`
}

// serveMockSetFreeBusyRaw —— makes the next freeBusy call echo back this exact JSON blob from
// the body (verifies the binding response normalization).
func (s *server) serveMockSetFreeBusyRaw(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req setFreeBusyRawRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.withState(func(st *gcalState) { st.freeBusyRaw = []byte(req.Body) })
	writeOK(s.log, w)
}

type setEventShapeRequest struct {
	Shape string `json:"shape"`
}

// serveMockSetEventShape —— controls whether events.insert returns an object (normal) or an
// array (shape mismatch).
func (s *server) serveMockSetEventShape(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req setEventShapeRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.withState(func(st *gcalState) { st.eventShape = req.Shape })
	writeOK(s.log, w)
}

func (s *server) serveMockGCalReset(w http.ResponseWriter, _ *http.Request) {
	s.withState(func(st *gcalState) {
		st.busy = nil
		st.events = nil
		st.deletedEvents = nil
		st.fails = nil
		st.freeBusyRaw = nil
		st.eventShape = ""
		st.oauthOutcome = ""
		st.lastAuthScopes = nil
		st.tokenCallCount = 0
		st.revoked = false
	})
	writeOK(s.log, w)
}

// failBody —— input to /__mock/gcal/fail: makes op's next `times` calls fail (-1 = forever).
type failBody struct {
	Op     string `json:"op"`
	Mode   string `json:"mode"`
	Status int    `json:"status"`
	Times  int    `json:"times"`
}

// serveMockGCalFail —— injects a transient failure for some op (retry-matrix e2e). status
// defaults to 503.
func (s *server) serveMockGCalFail(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req failBody
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.Status == 0 {
		req.Status = http.StatusServiceUnavailable
	}
	if req.Times == 0 { // "failNext" semantics: omitted count = fail once
		req.Times = 1
	}
	s.setFail(req.Op, &failInjection{
		mode: req.Mode, status: req.Status, remaining: req.Times,
	})
	writeOK(s.log, w)
}

// setFail —— records one injected failure for an op (lazily creates the map).
func (s *server) setFail(op string, f *failInjection) {
	s.withState(func(st *gcalState) {
		if st.fails == nil {
			st.fails = map[string]*failInjection{}
		}
		st.fails[op] = f
	})
}

// tokenFaultBody —— input to /__mock/gcal/token_fault: makes the next `times` refresh-token
// calls fail with a network error (dropped connection) or a 500 (not invalid_grant) (E7).
type tokenFaultBody struct {
	Mode  string `json:"mode"` // "network" | "500"
	Times int    `json:"times"`
}

// serveMockGCalTokenFault —— injects a network/500 fault into token refresh (distinct from
// revoke's invalid_grant). Verifies the backend treats it as transient — retry + friendly
// degrade — rather than as a revocation.
func (s *server) serveMockGCalTokenFault(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req tokenFaultBody
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.Times == 0 {
		req.Times = 1
	}
	s.setFail("token", &failInjection{
		mode: req.Mode, status: http.StatusInternalServerError, remaining: req.Times,
	})
	writeOK(s.log, w)
}

// hijackClose —— hijacks the connection and drops it outright, simulating a transport-layer
// network error (the client gets EOF/conn reset → the backend treats it as transient and
// retries). Shared by connreset-after-write and the token network fault.
func (s *server) hijackClose(w http.ResponseWriter) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		return
	}
	conn, _, err := hj.Hijack()
	if err != nil {
		s.log.Warn("hijack", logErrKey, err)
		return
	}
	if cerr := conn.Close(); cerr != nil {
		s.log.Warn("hijack close", logErrKey, cerr)
	}
}

// serveMockResetTokenCount —— clears only the token call count (invalid-grant-no-retry uses
// this to zero it out after a revoke, so the test can assert refresh was hit exactly once).
func (s *server) serveMockResetTokenCount(w http.ResponseWriter, _ *http.Request) {
	s.withState(func(st *gcalState) { st.tokenCallCount = 0 })
	writeOK(s.log, w)
}

// serveMockGCalRevoke —— an e2e control point: marks the connector as "the owner revoked
// authorization on Google's side." After this, every refresh_token grant returns
// invalid_grant, forcing the backend into the friendly-degrade path.
func (s *server) serveMockGCalRevoke(w http.ResponseWriter, _ *http.Request) {
	s.withState(func(st *gcalState) { st.revoked = true })
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

// writeCalendarUnauthorized —— the Calendar API's 401 (access token rejected: externally
// revoked, but the token itself hasn't expired). The backend's checkCalendarStatus maps 401
// to ErrUnauthorized → forces one refresh → the refresh hits invalid_grant → the revocation
// is persisted + friendly-degraded.
func writeCalendarUnauthorized(log *slog.Logger, w http.ResponseWriter) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusUnauthorized)
	if _, err := w.Write([]byte(`{"error":{"code":401,"message":"Invalid Credentials"}}`)); err != nil {
		log.Warn("write calendar 401", logErrKey, err)
	}
}

// writeInvalidGrant —— the OAuth invalid_grant error body (returned by refresh once revoked).
// The backend's decodeToken reads body.error == "invalid_grant" → ErrInvalidGrant.
func writeInvalidGrant(log *slog.Logger, w http.ResponseWriter) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusBadRequest)
	if _, err := w.Write([]byte(`{"error":"invalid_grant"}`)); err != nil {
		log.Warn("write invalid_grant", logErrKey, err)
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

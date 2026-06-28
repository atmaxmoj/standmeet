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
	deletedEvents  []mockEvent
	fails          map[string]*failInjection // op → injected failure (retry-matrix e2e)
	freeBusyRaw    []byte                     // set_freebusy_raw: 下次 freeBusy 原样回这个（一次性）
	eventShape     string                     // set_event_shape: "" | "object" | "array"（响应形状）
	tokenCallCount int
	revoked        bool // owner revoked at Google → next refresh returns invalid_grant
	mu             sync.Mutex
}

// failInjection —— e2e 控制点：让某个 op（"freeBusy" / "events.insert"）的下 N 次
// 调用失败，验证 connector 重试层。remaining: >0 = 还要失败的次数；-1 = 永远失败。
// mode "connreset-after-write"（仅 insert）：把（带幂等键的）事件写进 state 后断开
// 连接，模拟「写后响应丢失」——重试带同 id 重发 → 命中已存事件，验证不双订。
type failInjection struct {
	mode      string
	status    int
	remaining int
}

// takeFail —— op 这次该不该失败 + 怎么失败。命中则按 remaining 递减（-1 不减）。
// 调用方持有 s.gcal.mu。
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
	var (
		revoked bool
		fault   *failInjection
	)
	s.withState(func(st *gcalState) {
		st.tokenCallCount++
		revoked = st.revoked
		if grant == "refresh_token" {
			fault, _ = st.takeFail("token")
		}
	})
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
	resp := oauthTokenResponse{
		AccessToken: "mock-access-" + randomHex(mockAccessTokenLen),
		Scope:       mockScope,
		TokenType:   scopeOAuthTokenType,
		ExpiresIn:   defaultExpiresIn,
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
	if revoked { // 外部撤销 → access token 被拒（401）→ 后端刷新撞 invalid_grant 降级
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

// writeInsertShaped —— 正常回 object；set_event_shape=array 时回 [obj]（验 binding response
// 抽取对「形状不符」的处理：要么归一、要么拒，不崩）。
func (s *server) writeInsertShaped(w http.ResponseWriter, resp *insertEventResponse, shape string) {
	if shape == "array" {
		w.Header().Set("Content-Type", "application/json")
		// 明确的数组（≥2 元素）→ 求值出序列塞不进标量契约字段，后端优雅降级。
		if err := json.NewEncoder(w).Encode([]*insertEventResponse{resp, resp}); err != nil {
			s.log.Error("encode insert array", "err", err)
		}
		return
	}
	writeInsertEvent(s.log, w, resp)
}

const connResetAfterWrite = "connreset-after-write"

// eventID —— 用客户端幂等键作 event id；空则 mock 自分配。
func eventID(key string) string {
	if key != "" {
		return key
	}
	return "evt-" + randomHex(mockEventIDLen)
}

// insertDecision —— 锁内决定 insert 归宿并完成 state 写入。返回 (existing, fail)：
//   existing != nil → 同 id 已存（幂等重放），不重复写；
//   fail != nil     → 注入失败（connreset 模式已把事件写进 state，模拟「写后丢响应」）；
//   都 nil          → 正常新建（已 append）。
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

// applyInsertFail —— connreset 模式劫持连接直接断开（客户端拿到传输错 → 瞬时 →
// 重试）；其余模式回注入的状态码。
func (s *server) applyInsertFail(w http.ResponseWriter, fail *failInjection) {
	if fail.mode == connResetAfterWrite {
		s.hijackClose(w)
		return
	}
	http.Error(w, `{"error":"injected insert failure"}`, fail.status)
}

// findEvent —— 按 id 找已存事件（幂等去重）。调用方持锁。
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

// Events.delete handler 拆到 gcal_delete.go 守 max-lines。

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
		if st.freeBusyRaw != nil { // 一次性：原样回这坨 JSON（验 binding 对畸形/缺字段的归一）
			raw, st.freeBusyRaw = st.freeBusyRaw, nil
			return
		}
		if f, ok := st.takeFail("freeBusy"); ok {
			fail = f
			return
		}
		busy = append(busy, st.busy...)
	})
	if revoked { // 外部撤销后 access token 被拒（401）→ 后端刷新撞 invalid_grant 降级
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

// serveMockSetFreeBusyRaw —— 让下次 freeBusy 原样回 body 里这坨 JSON（验 binding response 归一）。
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

// serveMockSetEventShape —— 控 events.insert 回 object（正常）或 array（形状不符）。
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
		st.tokenCallCount = 0
		st.revoked = false
	})
	writeOK(s.log, w)
}

// failBody —— /__mock/gcal/fail 入参：让 op 的下 times 次失败（-1 = 永远）。
type failBody struct {
	Op     string `json:"op"`
	Mode   string `json:"mode"`
	Status int    `json:"status"`
	Times  int    `json:"times"`
}

// serveMockGCalFail —— 注入某 op 的瞬时失败（重试矩阵 e2e）。status 默认 503。
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

// setFail —— 记一条 op 的注入失败（懒建 map）。
func (s *server) setFail(op string, f *failInjection) {
	s.withState(func(st *gcalState) {
		if st.fails == nil {
			st.fails = map[string]*failInjection{}
		}
		st.fails[op] = f
	})
}

// tokenFaultBody —— /__mock/gcal/token_fault 入参：让接下来 times 次 refresh token
// 调用以 network 错（断连）或 500（非 invalid_grant）失败（E7）。
type tokenFaultBody struct {
	Mode  string `json:"mode"` // "network" | "500"
	Times int    `json:"times"`
}

// serveMockGCalTokenFault —— 注入 token refresh 的 network/500 故障（区别于 revoke
// 的 invalid_grant）。验证后端把它当瞬时错重试 + 友好降级，不当撤销。
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

// hijackClose —— 劫持连接直接断开，模拟传输层 network 错（客户端拿到 EOF/conn
// reset → 后端当瞬时错重试）。connreset-after-write 与 token network 故障共用。
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

// serveMockResetTokenCount —— 只清 token 调用计数（invalid-grant-no-retry 用它
// 在 revoke 之后归零，单测 refresh 恰好命中一次）。
func (s *server) serveMockResetTokenCount(w http.ResponseWriter, _ *http.Request) {
	s.withState(func(st *gcalState) { st.tokenCallCount = 0 })
	writeOK(s.log, w)
}

// serveMockGCalRevoke —— e2e 控制点：把连接器标记为「owner 在 Google 端撤销
// 了授权」。之后任何 refresh_token grant 都返 invalid_grant，逼后端走友好降级。
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

// writeCalendarUnauthorized —— 日历 API 401（access token 被拒：外部撤销但 token
// 未过期）。后端 checkCalendarStatus 把 401 映成 ErrUnauthorized → 强制刷新一次 →
// 刷新撞 invalid_grant → 撤销落库 + 友好降级。
func writeCalendarUnauthorized(log *slog.Logger, w http.ResponseWriter) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusUnauthorized)
	if _, err := w.Write([]byte(`{"error":{"code":401,"message":"Invalid Credentials"}}`)); err != nil {
		log.Warn("write calendar 401", logErrKey, err)
	}
}

// writeInvalidGrant —— OAuth invalid_grant 错误体（revoked 后 refresh 返这个）。
// 后端 decodeToken 读 body.error == "invalid_grant" → ErrInvalidGrant。
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

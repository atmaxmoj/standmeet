// external-mock —— test-only HTTP server serving captured job-board fixtures.
//
// Started by docker-compose.dev.yml alongside the backend; backend env vars
// (GREENHOUSE_BASE_URL, LEVER_BASE_URL, ...) point at this server so e2e
// runs don't hit real Greenhouse/Lever/Ashby/etc. Fixtures live in
// e2e/fixtures/job-boards/{kind}/*.day1.{json|rss}, mounted as /fixtures
// inside the container.
//
// Routes (mirror real upstream URL shape so adapter URL-building works):
//
//	GET  /greenhouse/v1/boards/{company}/jobs?content=true
//	GET  /lever/v0/postings/{company}?mode=json
//	GET  /ashby/posting-api/job-board/{slug}
//	GET  /remoteok/api
//	GET  /wwr/categories/{slug}.rss
//	GET  /hn/v0/user/whoishiring.json
//	GET  /hn/v0/item/{id}.json
//
// Admin / test-control routes:
//
//	POST /__mock/set_day?kind=greenhouse&day=2
//	  → switch a kind's served day; tests use day=2 to simulate "next day"
//	    where day1 ids drop off + new ids appear (per day2 derivation rule)
//	GET  /__mock/state
//	  → JSON dump of current day per kind (debug)
//	POST /__mock/reset
//	  → reset all days back to 1
//
// day2 isn't a separate fixture on disk in v1 —— it's *derived* from day1
// at serve time by skipping the first 2 entries and appending 2 synthetic
// ones (with predictable ids `mockday2-1`, `mockday2-2`). Specs assert on
// these synthetic ids. Keeping derivation in code means fixtures stay
// single-source-of-truth (just day1 from `make capture-job-fixtures`).
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	defaultPort    = "9000"
	defaultRoot    = "/fixtures"
	jobBoardSubdir = "job-boards"
	marketSubdir   = "marketplace"
	readHeaderTime = 5 * time.Second
	dayTwo         = 2
	syntheticDay2A = "mockday2-1"
	syntheticDay2B = "mockday2-2"
	dropFromFront  = 2
	jsonExt        = "json"
	rssExt         = "rss"
	jsonMIME       = "application/json"
)

func main() {
	port := flag.String("port", envOr("PORT", defaultPort), "listen port")
	root := flag.String("fixtures", envOr("FIXTURES_DIR", defaultRoot), "fixtures dir")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	srv := newServer(*root, log)
	if err := srv.run(*port); err != nil {
		log.Error("server exit", "err", err)
		os.Exit(1)
	}
}

// state holds per-kind current day (mutable, guarded by mu).
type state struct {
	day map[string]int
	mu  sync.RWMutex
}

func (s *state) get(kind string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if d, ok := s.day[kind]; ok {
		return d
	}
	return 1
}

func (s *state) setDay(kind string, d int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.day[kind] = d
}

func (s *state) reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.day = map[string]int{}
}

func (s *state) snapshot() map[string]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]int, len(s.day))
	maps.Copy(out, s.day)
	return out
}

type server struct {
	st        *state
	log       *slog.Logger
	inference inferenceQueue
	root      string
	gcal      gcalState
	sendgrid  sendgridState
	caldav    caldavState
}

func newServer(root string, log *slog.Logger) *server {
	return &server{
		st:   &state{day: map[string]int{}},
		log:  log,
		root: root,
	}
}

// logRequests —— 每个入站请求记 method+path（调试用：看清消费侧到底打哪个端点）。
func (s *server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.log.Info("mock request", "method", r.Method, "path", r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func (s *server) run(port string) error {
	mux := http.NewServeMux()
	s.routes(mux)
	addr := ":" + port
	s.log.Info("external-mock listening", "addr", addr, "root", s.root)
	srv := &http.Server{
		Addr:              addr,
		Handler:           s.logRequests(mux),
		ReadHeaderTimeout: readHeaderTime,
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("listen: %w", err)
	}
	return nil
}

func (s *server) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /greenhouse/v1/boards/{company}/jobs", s.serveGreenhouse)
	mux.HandleFunc("GET /lever/v0/postings/{company}", s.serveLever)
	mux.HandleFunc("GET /ashby/posting-api/job-board/{slug}", s.serveAshby)
	mux.HandleFunc("GET /remoteok/api", s.serveRemoteOK)
	// Go 1.22+ ServeMux wildcards must terminate at end-of-segment, so we
	// can't use `{slug}.rss`. Match the whole filename and strip .rss in
	// the handler.
	mux.HandleFunc("GET /wwr/categories/{filename}", s.serveWWR)
	mux.HandleFunc("GET /hn/v0/user/whoishiring.json", s.serveHNUser)
	// Same wildcard-suffix issue as WWR — match full filename, strip in handler.
	mux.HandleFunc("GET /hn/v0/item/{filename}", s.serveHNItem)
	// JBA (Feashliaa) chunked archive；适配器只 GET 这两条路径。
	mux.HandleFunc("GET /jba/data/chunks/{filename}", s.serveJBA)
	// J.6b: Workday CXS + BambooHR careers/list (跟 ATS 真 endpoint 同 path)。
	mux.HandleFunc("POST /workday/wday/cxs/{tenant}/{site}/jobs", s.serveWorkday)
	mux.HandleFunc("GET /bamboohr/careers/list", s.serveBambooHR)
	// Workable SPI jobs (authed): Bearer token required, wrong/missing → 401.
	mux.HandleFunc("GET /workable/spi/v3/accounts/{company}/jobs", s.serveWorkable)

	mux.HandleFunc("POST /__mock/set_day", s.adminSetDay)
	mux.HandleFunc("GET /__mock/state", s.adminState)
	mux.HandleFunc("POST /__mock/reset", s.adminReset)

	// skill-marketplace mocks — the backend marketplace package's
	// GitHub + SkillsMP clients point here in dev/e2e.
	mux.HandleFunc("GET /marketplace/github/contents/skills", s.serveMarketplaceGitHub)
	mux.HandleFunc("GET /marketplace/skillsmp/skills/search", s.serveMarketplaceSkillsMP)
	// #48-3 install: SKILL.md fetch endpoints (per-skill detail).
	mux.HandleFunc("GET /marketplace/github/contents/skills/{id}/SKILL.md", s.serveMarketplaceGitHubSkillMD)
	mux.HandleFunc("GET /marketplace/skillsmp/skills/{id}", s.serveMarketplaceSkillsMPSkillMD)

	// Google Calendar OAuth + API + FreeBusy mocks. Backend's
	// internal/gcal package points GOOGLE_OAUTH_BASE_URL and
	// GOOGLE_CALENDAR_BASE_URL at these in dev/e2e.
	mux.HandleFunc("GET /google-oauth/auth", s.serveOAuthAuth)
	mux.HandleFunc("POST /google-oauth/token", s.serveOAuthToken)
	const insertRoute = "POST /google-calendar/calendars/{calendarId}/events"
	mux.HandleFunc(insertRoute, s.serveCalendarEventsInsert)
	const deleteRoute = "DELETE /google-calendar/calendars/{calendarId}/events/{eventId}"
	mux.HandleFunc(deleteRoute, s.serveCalendarEventsDelete)
	mux.HandleFunc("POST /google-calendar/freeBusy", s.serveCalendarFreeBusy)
	// /__mock/gcal/* — control endpoints e2e specs use to seed busy
	// fixtures and inspect inserted events.
	mux.HandleFunc("POST /__mock/gcal/set_busy", s.serveMockSetBusy)
	mux.HandleFunc("POST /__mock/gcal/set_freebusy_raw", s.serveMockSetFreeBusyRaw)
	mux.HandleFunc("POST /__mock/gcal/set_event_shape", s.serveMockSetEventShape)
	mux.HandleFunc("POST /__mock/gcal/revoke", s.serveMockGCalRevoke)
	mux.HandleFunc("POST /__mock/gcal/reset", s.serveMockGCalReset)
	// happy-matrix 上传的 openapi calendar spec：servers 指 /__mock/gcal，paths /freeBusy /events。
	// 复用同一套 gcal 处理器 + 同一份事件状态（getEvents 控制端点也读它），归一到一个日历 mock。
	mux.HandleFunc("POST /__mock/gcal/freeBusy", s.serveCalendarFreeBusy)
	mux.HandleFunc("POST /__mock/gcal/events", s.serveCalendarEventsInsert)
	// 上传 spec 自带的 oauth2 端点（combo 1）：authorize（浏览器跳）+ token（后端换），复用同一 mock。
	mux.HandleFunc("GET /__mock/gcal/authorize", s.serveOAuthAuth)
	mux.HandleFunc("POST /__mock/gcal/token", s.serveOAuthToken)
	// 上传 spec 的 openapi mail（combo 4）：POST /send，mock 经 SMTP 转投 Mailpit，让消费侧能查到。
	mux.HandleFunc("POST /__mock/mailapi/send", s.serveMailAPISend)
	// programmable OAuth control plane (connect-flow §8 区 D): 编程 dance 结局 + 读记录（GET 触发）。
	mux.HandleFunc("GET /__mock/oauth/program", s.serveOAuthProgram)
	mux.HandleFunc("GET /__mock/oauth/reset", s.serveOAuthRecordReset)
	mux.HandleFunc("GET /__mock/oauth/last_authorize", s.serveOAuthLastAuthorize)
	mux.HandleFunc("GET /__mock/oauth/token_call_count", s.serveOAuthTokenCallCount)
	// CRM-ish SaaS mock (#155 §3 agent-tool exposure): binding-less openapi connector 落点
	mux.HandleFunc("GET /crm/contacts", s.serveCRMContacts)
	mux.HandleFunc("POST /crm/contacts/search", s.serveCRMContactSearch)
	mux.HandleFunc("POST /crm/deals", s.serveCRMDealCreate)
	// SendGrid-style mail mock (#155 §8 openapi-mail)
	mux.HandleFunc("POST /__mock/sendgrid/mail/send", s.serveSendGridSend)
	mux.HandleFunc("GET /__mock/sendgrid/sent", s.serveSendGridSent)
	mux.HandleFunc("POST /__mock/sendgrid/fail", s.serveSendGridFail)
	mux.HandleFunc("POST /__mock/sendgrid/reset", s.serveSendGridReset)
	// consume-time SSRF probe: benign base, 302s to cloud-metadata at call time (#155 §8-H)
	mux.HandleFunc("/__mock/ssrf/redirect-internal/", s.serveSSRFRedirectInternal)
	// CalDAV server mock (#155 §8 provider-agnostic): per-connector collection + control plane
	mux.HandleFunc("REPORT /caldav/{coll}", s.serveCalDAVReport)
	mux.HandleFunc("PROPFIND /caldav/{coll}", s.serveCalDAVPropfind)
	mux.HandleFunc("PUT /caldav/{coll}/{file}", s.serveCalDAVPut)
	mux.HandleFunc("DELETE /caldav/{coll}/{file}", s.serveCalDAVDelete)
	mux.HandleFunc("GET /__mock/caldav/{coll}/events", s.serveCalDAVEvents)
	mux.HandleFunc("POST /__mock/caldav/{coll}/fail", s.serveCalDAVFail)
	mux.HandleFunc("POST /__mock/caldav/{coll}/set_busy", s.serveCalDAVSetBusy)
	mux.HandleFunc("POST /__mock/caldav/{coll}/reset", s.serveCalDAVReset)
	mux.HandleFunc("GET /__mock/gcal/events", s.serveMockGCalEvents)
	mux.HandleFunc("GET /__mock/gcal/deleted_events", s.serveMockGCalDeletedEvents)
	mux.HandleFunc("GET /__mock/gcal/token_call_count", s.serveMockGCalTokenCount)
	mux.HandleFunc("POST /__mock/gcal/reset_token_count", s.serveMockResetTokenCount)
	mux.HandleFunc("POST /__mock/gcal/fail", s.serveMockGCalFail)
	mux.HandleFunc("POST /__mock/gcal/token_fault", s.serveMockGCalTokenFault)
	// /__mock/inference/* —— mock LLM scripting bridge for backend's
	// MockProvider. Tests POST {name,args} to /next_tool; backend GETs
	// /take_next_tool before each Stream and clears the queue atomically.
	mux.HandleFunc("POST /__mock/inference/next_tool", s.serveMockSetNextTool)
	mux.HandleFunc("GET /__mock/inference/take_next_tool", s.serveMockTakeNextTool)
	mux.HandleFunc("POST /__mock/inference/next_reply", s.serveMockSetNextReply)
	mux.HandleFunc("GET /__mock/inference/take_next_reply", s.serveMockTakeNextReply)
}

func (s *server) serveGreenhouse(w http.ResponseWriter, r *http.Request) {
	s.serveJSONKind(w, r, "greenhouse", r.PathValue("company"), greenhouseDay2)
}

func (s *server) serveLever(w http.ResponseWriter, r *http.Request) {
	s.serveJSONKind(w, r, "lever", r.PathValue("company"), leverDay2)
}

// workableSPIToken —— the fixed Bearer token the Workable SPI fixture expects (e2e passes it as the
// owner's api_token). A wrong/missing token 401s, exercising the adapter's real authed path.
const workableSPIToken = "wk-spi-secret-token"

func (s *server) serveWorkable(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+workableSPIToken {
		w.Header().Set("Content-Type", jsonMIME)
		w.WriteHeader(http.StatusUnauthorized)
		writeBody(s.log, w, []byte(`{"error":"invalid or missing SPI token"}`))
		return
	}
	s.serveJSONKind(w, r, "workable", r.PathValue("company"), nil)
}

func (s *server) serveAshby(w http.ResponseWriter, r *http.Request) {
	s.serveJSONKind(w, r, "ashby", r.PathValue("slug"), ashbyDay2)
}

func (s *server) serveRemoteOK(w http.ResponseWriter, r *http.Request) {
	s.serveJSONKind(w, r, "remoteok", "api", remoteOKDay2)
}

func (s *server) serveWWR(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	const rssSuffix = ".rss"
	if !strings.HasSuffix(filename, rssSuffix) {
		s.notFound(w, r, fmt.Errorf("wwr expects .rss suffix: %s", filename))
		return
	}
	slug := strings.TrimSuffix(filename, rssSuffix)
	body, err := s.readFixture("wwr", slug, rssExt)
	if err != nil {
		s.notFound(w, r, err)
		return
	}
	if s.st.get("wwr") == dayTwo {
		body = wwrDay2(body)
	}
	w.Header().Set("Content-Type", "application/rss+xml")
	writeBody(s.log, w, body)
}

func (s *server) serveHNUser(w http.ResponseWriter, r *http.Request) {
	s.serveJSONKind(w, r, "hn", "whoishiring", hnUserDay2)
}

func (s *server) serveHNItem(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	const jsonSuffix = ".json"
	if !strings.HasSuffix(filename, jsonSuffix) {
		s.notFound(w, r, fmt.Errorf("hn item expects .json suffix: %s", filename))
		return
	}
	id := strings.TrimSuffix(filename, jsonSuffix)
	s.serveJSONKind(w, r, "hn", "item-"+id, hnItemDay2)
}

// serveJBA —— manifest 跟 chunked gzip 都走这条；fixture 文件保留原扩展名
// (.json / .json.gz) 直接 readFile 透传，不走 .day1. 命名 (JBA 不需要 day2
// 变化测；fixture 一次性铺好就行)。
func (s *server) serveJBA(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	body, err := s.readJBAFixture(filename)
	if err != nil {
		s.notFound(w, r, err)
		return
	}
	w.Header().Set("Content-Type", jbaContentType(filename))
	writeBody(s.log, w, body)
}

func jbaContentType(filename string) string {
	if strings.HasSuffix(filename, ".json.gz") {
		return "application/gzip"
	}
	return jsonMIME
}

func (s *server) readJBAFixture(filename string) ([]byte, error) {
	path := filepath.Clean(filepath.Join(s.root, jobBoardSubdir, "jba", filename))
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read jba fixture %s: %w", path, err)
	}
	return body, nil
}

// serveWorkday —— POST /workday/wday/cxs/{tenant}/{site}/jobs → fixture
// 名按 {tenant}-{site}.day1.json (site 决定哪个 board 子集；e2e 多数情况
// 一个 tenant 只 fixture 一个 site)。
func (s *server) serveWorkday(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("tenant") + "-" + r.PathValue("site")
	s.serveJSONKind(w, r, "workday", slug, nil)
}

// serveBambooHR —— GET /bamboohr/careers/list?company={slug} → fixture
// 按 company query param 选；真 prod 是 {slug}.bamboohr.com/careers/list，
// adapter 在 envBase 模式下 query string 替子域。
func (s *server) serveBambooHR(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("company")
	if slug == "" {
		s.notFound(w, r, fmt.Errorf("bamboohr missing company query"))
		return
	}
	s.serveJSONKind(w, r, "bamboohr", slug, nil)
}

// serveJSONKind is the JSON-flavour helper: read {kind}/{slug}.day1.json,
// optionally apply day2 transform, write back. ext is implicit (json).
func (s *server) serveJSONKind(
	w http.ResponseWriter, r *http.Request,
	kind, slug string, day2 func([]byte) []byte,
) {
	body, err := s.readFixture(kind, slug, jsonExt)
	if err != nil {
		s.notFound(w, r, err)
		return
	}
	if s.st.get(kind) == dayTwo && day2 != nil {
		body = day2(body)
	}
	w.Header().Set("Content-Type", jsonMIME)
	writeBody(s.log, w, body)
}

func (s *server) readFixture(kind, slug, ext string) ([]byte, error) {
	path := filepath.Clean(filepath.Join(s.root, jobBoardSubdir, kind, slug+".day1."+ext))
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read fixture %s: %w", path, err)
	}
	return body, nil
}

func writeBody(log *slog.Logger, w http.ResponseWriter, body []byte) {
	if _, err := w.Write(body); err != nil {
		log.Warn("write body", "err", err)
	}
}

func (s *server) notFound(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Warn("fixture miss", "url", r.URL.String(), "err", err)
	http.Error(w, "fixture not found", http.StatusNotFound)
}

// adminSetDay POST /__mock/set_day?kind=greenhouse&day=2.
func (s *server) adminSetDay(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	day := r.URL.Query().Get("day")
	if kind == "" || day == "" {
		http.Error(w, "kind and day required", http.StatusBadRequest)
		return
	}
	d := 1
	if day == "2" {
		d = dayTwo
	}
	s.st.setDay(kind, d)
	w.WriteHeader(http.StatusNoContent)
}

// adminState GET /__mock/state.
func (s *server) adminState(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", jsonMIME)
	if err := json.NewEncoder(w).Encode(s.st.snapshot()); err != nil {
		s.log.Warn("encode state", "err", err)
	}
}

// adminReset POST /__mock/reset.
func (s *server) adminReset(w http.ResponseWriter, _ *http.Request) {
	s.st.reset()
	w.WriteHeader(http.StatusNoContent)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

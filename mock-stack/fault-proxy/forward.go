// forward.go —— the forwarding half: if a fault is armed, handle it per mode; if not, pass through as-is.

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	modeRateLimit   = "ratelimit"
	modeClampTokens = "clamp_tokens"
	modeHTTPError   = "http_error"
	modeSlow        = "slow"
)

// defaultSlowMS —— how long `slow` holds when delay_ms isn't given. Long enough for a
// person to take a screenshot, but not so long the driver thinks the proxy is stuck.
const defaultSlowMS = 8000

func (s *server) forward(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	got := s.take(r.URL.Path)
	if got != nil && got.Mode == modeRateLimit {
		s.writeRateLimit(w, got)
		return
	}
	if got != nil && got.Mode == modeHTTPError {
		s.writeHTTPError(w, r.URL.Path, got)
		return
	}
	if got != nil && got.Mode == modeClampTokens {
		body = clampMaxTokens(body, got.MaxTokens, s.logClamp)
	}
	s.holdIfSlow(r, got)
	s.pipe(w, r, body)
}

// holdIfSlow —— **holds this one request path halfway** before forwarding it; everything
// else proceeds as normal.
//
// Why this mode is needed: a whole family of UI defects only lives in **the frame while
// it's still loading** — the number hasn't arrived yet, but a sentence grown from that
// number is already asserting "zero" (F-L-52/53). Locally that frame is only tens of
// milliseconds, invisible to the eye, so it stays unattended. Holding one particular GET
// back turns that frame into a state that can be watched and screenshotted at leisure.
//
// What's held is **this one hop's forwarding** — the request and response are unchanged:
// what's under test is what the caller says while it "hasn't gotten the data yet".
func (s *server) holdIfSlow(r *http.Request, f *fault) {
	if f == nil || f.Mode != modeSlow {
		return
	}
	ms := f.DelayMS
	if ms <= 0 {
		ms = defaultSlowMS
	}
	s.log.Info("holding request", "path", r.URL.Path, "delay_ms", ms)
	select {
	case <-time.After(time.Duration(ms) * time.Millisecond):
	case <-r.Context().Done(): // caller already gave up, stop holding it
	}
}

// writeHTTPError —— makes **this one request path** return a failure status; everything
// else forwards as normal.
//
// The body is plain JSON that doesn't impersonate any specific upstream's error shape:
// what this mode tests is **the caller's UI** ("what does it say when a block fails to
// load"), not the code that parses an upstream error body. Impersonating a specific
// error shape would just make the driver think that parsing path had been verified too.
func (s *server) writeHTTPError(w http.ResponseWriter, path string, f *fault) {
	code := f.Status
	if code <= 0 {
		code = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"type":    "injected_failure",
			"message": "injected by fault-proxy",
		},
	})
	s.log.Info("injected http error", "status", code, "path", path)
}

// writeRateLimit —— shaped like a real provider: 429 + `Retry-After` seconds +
// a provider-style JSON body (some clients only read the body, not the header, so
// giving both is what makes it look real).
func (s *server) writeRateLimit(w http.ResponseWriter, f *fault) {
	secs := f.RetryAfterSeconds
	if secs <= 0 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"type":    "rate_limit_error",
			"message": "rate limit exceeded (injected by llm-fault-proxy)",
		},
	})
	s.log.Info("injected 429", "retry_after_seconds", secs)
}

func (s *server) logClamp(from, to int) {
	s.log.Info("clamped max_tokens", "from", from, "to", to)
}

// clampMaxTokens —— shrinks the request body's max_tokens. **Only this one field
// changes**, everything else stays as-is, because the point is to make the real model
// hit the length cap on its own normal path.
//
// JSON that can't be parsed is returned unchanged: the proxy shouldn't swallow a request
// just because it can't understand it. If it can't be parsed, just pass it through as
// if nothing happened — the upstream will give its own verdict, which is closer to the
// truth than the proxy manufacturing an error in the middle.
func clampMaxTokens(body []byte, to int, onClamp func(from, to int)) []byte {
	if to <= 0 {
		return body
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return body
	}
	from := 0
	if v, ok := payload["max_tokens"].(float64); ok {
		from = int(v)
	}
	payload["max_tokens"] = to
	out, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	onClamp(from, to)
	return out
}

// pipe —— sends the request to upstream unchanged, then sends the response back
// unchanged. **The whole request header set is carried over** (Authorization is in
// there): the proxy doesn't parse, store, or print the key.
//
// A streamed response must be **written as it's received**, Flushing every chunk: the
// agent loop relies on SSE to get tokens chunk by chunk, and buffering the whole thing
// before sending would turn "streaming" into "one-shot", which would change the timing
// under test.
func (s *server) pipe(w http.ResponseWriter, r *http.Request, body []byte) {
	url := strings.TrimSuffix(s.upstream, "/") + r.URL.Path
	if r.URL.RawQuery != "" {
		url += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, url, bytes.NewReader(body))
	if err != nil {
		http.Error(w, "build upstream request", http.StatusBadGateway)
		return
	}
	req.Header = r.Header.Clone()
	stripHopByHop(req.Header)
	req.ContentLength = int64(len(body))
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		s.log.Error("upstream", "err", err, "url", url)
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	// Log a line even on a successful forward. **Without it, this log's silence has two
	// meanings** — "no traffic" and "forwarding fine" look identical, and the driver
	// relies on exactly this to judge whether the product is even wired to the proxy.
	// The first time I used it I nearly concluded "the product isn't going through the
	// proxy" on that basis — that round was actually completely normal.
	s.log.Info("forwarded", "path", r.URL.Path, "status", resp.StatusCode)
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	streamCopy(w, resp.Body)
}

// stripHopByHop —— hop-by-hop headers must not be forwarded (RFC 9110 §7.6.1): they
// describe **this one connection hop**, not the request itself. Content-Length is
// dropped too — the length is authoritative via req.ContentLength, and having it stated
// in two places risks the two disagreeing.
//
// **The reason for this change is the spec, not a diagnosis.** While driving this
// module on 2026-08-13, upstream once threw an `unexpected EOF`; I suspected but had
// **no evidence** this was the cause — this fix is here because a proxy ought to do
// this regardless. Whether that EOF is actually fixed won't be known until it's hit
// again for real — don't record a guess as a conclusion.
func stripHopByHop(h http.Header) {
	for _, k := range []string{
		"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
		"Te", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length",
	} {
		h.Del(k)
	}
}

func copyHeaders(dst, src http.Header) {
	for k, vals := range src {
		for _, v := range vals {
			dst.Add(k, v)
		}
	}
}

func streamCopy(w http.ResponseWriter, src io.Reader) {
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

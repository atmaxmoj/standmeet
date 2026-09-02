// fault-proxy —— a fault-injection proxy that sits in front of **any real upstream**.
//
// Why it exists: several modules' Real deps say "a real service, or a proxy in front of it that
// can inject faults" — agent-loop-robustness wants rate-limiting/truncation in front of a real LLM
// provider, corpus-acl-editing check 6 wants **a single admin endpoint** to fail to load (a whole-
// stack outage is a different case, and that one has already been driven and hit F-N-2).
// The llm-gateway already in this repo takes a different path — it **replaces** the model outright
// and scripts replies by keyword. That path is enough for "how does the UI display it", but not
// enough for these modules: what needs verifying is exactly **the real upstream's behavior under a
// fault**, and swapping in a script would swap out the thing under test.
//
// **It used to be called llm-fault-proxy and only blocked LLM traffic.** When the second use case
// came along, copying it into a separate api-fault-proxy would have been the path of least
// resistance, and also wrong: the two copies would drift apart over time, and their only real
// difference is the **upstream address** and **which path to block** — that's configuration, not a
// new category of thing.
//
// Shaped after mock-stack/mail (the SMTP fault mock in front of mailpit), nothing new invented:
//
//	HTTP  :9500 (PORT overridable)
//	  /*                          —— forwarded as-is to UPSTREAM_BASE_URL
//	  POST /__mock/fault/arm      —— arms one fault {mode, path_prefix, times, ...}
//	  POST /__mock/fault/reset    —— disarms it
//	  GET  /__mock/fault/state    —— how many shots remain (for the person driving, not for assertions)
//
// **Three modes, different in kind — don't conflate them:**
//
//   - `ratelimit` —— the proxy itself returns 429 + `Retry-After`. **This part is faked**, since
//     there's no way to make a real upstream rate-limit on demand. Only that one response is faked;
//     what's under test is the caller's backoff behavior, and that part is real.
//
//   - `clamp_tokens` —— **nothing is faked**. Shrinks `max_tokens` in the request body before
//     forwarding, so the **real model** genuinely gets cut off mid-write, and the stop reason that
//     comes back is the model's own.
//
//   - `http_error` —— the proxy itself returns a status code (default 500). For "one endpoint is
//     down, what does the UI say" cases. Also fakes just that one response; what's under test is
//     the UI.
//
// **`path_prefix` is the filter shared by all three modes**, and it's exactly the line between a
// "narrow fault" and a "whole-stack outage": omit it and everything passing through is blocked;
// give it and only paths starting with that prefix are blocked, **everything else forwards
// normally**. A narrow fault wants "when this one piece fails to load, the page says it failed to
// load, instead of wearing an empty state's clothes" — if the whole backend is down, that's a
// different path to verify.
//
// The upstream address is read from UPSTREAM_BASE_URL, **credentials are never touched** — headers
// are passed through as-is. The proxy doesn't store, inspect, or log them.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"sync"
)

func main() {
	upstream := os.Getenv("UPSTREAM_BASE_URL")
	if upstream == "" {
		slog.Error("UPSTREAM_BASE_URL is required — this proxy has nothing to sit in front of")
		os.Exit(2)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "9500"
	}
	srv := &server{upstream: upstream, log: slog.Default()}
	mux := http.NewServeMux()
	mux.HandleFunc("/__mock/fault/arm", srv.arm)
	mux.HandleFunc("/__mock/fault/reset", srv.reset)
	mux.HandleFunc("/__mock/fault/state", srv.state)
	mux.HandleFunc("/", srv.forward)
	srv.log.Info("fault-proxy up", "port", port, "upstream", upstream)
	if err := http.ListenAndServe(":"+port, mux); err != nil { //nolint:gosec // mock, no timeouts needed
		srv.log.Error("listen", "err", err)
		os.Exit(1)
	}
}

// server —— the upstream address + whichever fault is currently armed.
type server struct {
	log      *slog.Logger
	upstream string
	mu       sync.Mutex
	fault    *fault
}

// fault —— the currently armed fault. Omitting times = stays in effect indefinitely (until reset),
// simulating "the upstream is persistently faulty".
type fault struct {
	Mode string `json:"mode"`
	// PathPrefix —— only blocks request paths starting with this. Empty = blocks everything
	// passing through. This one field is the entirety of a "narrow fault": everything else on
	// the page loads normally, only one piece is broken.
	PathPrefix string `json:"path_prefix"`
	// Times —— how many more times it takes effect. 0 with Sticky false = used up.
	Times int `json:"times"`
	// Sticky —— the request didn't give a times value: stays in effect indefinitely.
	Sticky bool `json:"sticky"`
	// RetryAfterSeconds —— seconds written into the `Retry-After` header in ratelimit mode.
	RetryAfterSeconds int `json:"retry_after_seconds"`
	// MaxTokens —— in clamp_tokens mode, the request body's max_tokens is rewritten to this value.
	MaxTokens int `json:"max_tokens"`
	// Status —— the status code returned in http_error mode. 0 = 500.
	Status int `json:"status"`
	// DelayMS —— in slow mode, how many milliseconds to hold this path before forwarding. 0 = defaultSlowMS.
	DelayMS int `json:"delay_ms"`
}

// take —— pulls out the fault that should apply **to this path** and decrements its count. Returns
// nil if none is armed / the path doesn't match / it's used up.
//
// The count is **not decremented** on a path mismatch: `times: 1` means "make that one endpoint
// fail once", not "make the next request that comes through, whichever it is, fail once". A page
// load fires several endpoints concurrently, and decrementing by arrival order would leave which
// one gets hit up to a race — that kind of red is [[red-in-the-wrong-place]].
func (s *server) take(path string) *fault {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fault == nil || !s.fault.matches(path) {
		return nil
	}
	got := *s.fault
	if !s.fault.Sticky {
		s.fault.Times--
		if s.fault.Times <= 0 {
			s.fault = nil
		}
	}
	return &got
}

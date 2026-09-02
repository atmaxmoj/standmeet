// control.go —— the three HTTP endpoints for arming/resetting/inspecting a fault.
// Same shape as the mail mock's /__mock/smtp/*.

package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// armBody —— the request body for POST /__mock/fault/arm.
//
// Omitting times = stays in effect indefinitely (until reset), simulating "the
// upstream is persistently down"; giving a number makes it fire only that many times,
// for driving flows like "succeeds on the second try after backing off".
// Omitting path_prefix = blocks everything that passes through; giving one blocks
// only that path, everything else forwards normally (a narrow fault).
type armBody struct {
	Mode              string `json:"mode"`
	PathPrefix        string `json:"path_prefix"`
	Times             int    `json:"times"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
	MaxTokens         int    `json:"max_tokens"`
	Status            int    `json:"status"`
	// DelayMS —— how long (ms) `slow` holds the response. Omitted falls back to defaultSlowMS.
	DelayMS int `json:"delay_ms"`
}

// knownModes —— the modes we recognize. Unknown ones are rejected outright; see arm for why.
var knownModes = []string{modeRateLimit, modeClampTokens, modeHTTPError, modeSlow}

func (s *server) arm(w http.ResponseWriter, r *http.Request) {
	var in armBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if !known(in.Mode) {
		// Reject an unknown mode outright. Silently treating it as "inject nothing" would
		// let whoever's driving the test believe the fault was armed while seeing a normal
		// response, then record "couldn't reproduce" as the conclusion — the worst kind of
		// silent failure.
		http.Error(w, "mode must be one of "+strings.Join(knownModes, " / "), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.fault = &fault{
		Mode: in.Mode, PathPrefix: in.PathPrefix,
		Times: in.Times, Sticky: in.Times <= 0,
		RetryAfterSeconds: in.RetryAfterSeconds, MaxTokens: in.MaxTokens,
		Status: in.Status, DelayMS: in.DelayMS,
	}
	s.mu.Unlock()
	s.log.Info("fault armed", "mode", in.Mode, "path_prefix", in.PathPrefix,
		"times", in.Times, "retry_after", in.RetryAfterSeconds,
		"max_tokens", in.MaxTokens, "status", in.Status, "delay_ms", in.DelayMS)
	writeJSON(w, map[string]string{"armed": in.Mode})
}

func known(mode string) bool {
	for _, m := range knownModes {
		if m == mode {
			return true
		}
	}
	return false
}

// matches —— whether this path falls within range of this fault. Empty prefix = everything.
func (f *fault) matches(path string) bool {
	return f.PathPrefix == "" || strings.HasPrefix(path, f.PathPrefix)
}

func (s *server) reset(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.fault = nil
	s.mu.Unlock()
	s.log.Info("fault cleared")
	writeJSON(w, map[string]string{"armed": ""})
}

func (s *server) state(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	got := s.fault
	s.mu.Unlock()
	if got == nil {
		writeJSON(w, map[string]any{"armed": nil})
		return
	}
	writeJSON(w, got)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

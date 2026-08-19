// control.go —— 装/卸/看故障的三个 HTTP 端点。跟 mail mock 的 /__mock/smtp/* 同形。

package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

// armBody —— POST /__mock/fault/arm 的入参。
//
// times 省略 = 一直生效(直到 reset),模拟「上游持续故障」;给了数字就只生效那么多次,
// 用来驱「退避之后第二次成功」这类走向。
// path_prefix 省略 = 挡住经过的一切;给了就只挡它,其余照常转发(窄故障)。
type armBody struct {
	Mode              string `json:"mode"`
	PathPrefix        string `json:"path_prefix"`
	Times             int    `json:"times"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
	MaxTokens         int    `json:"max_tokens"`
	Status            int    `json:"status"`
	// DelayMS —— `slow` 扣住多久(毫秒)。省略走 defaultSlowMS。
	DelayMS int `json:"delay_ms"`
}

// knownModes —— 认识的 mode。未知的直接拒,理由见 arm。
var knownModes = []string{modeRateLimit, modeClampTokens, modeHTTPError, modeSlow}

func (s *server) arm(w http.ResponseWriter, r *http.Request) {
	var in armBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if !known(in.Mode) {
		// 未知 mode 直接拒。默默当成「不注入」会让驱动的人以为注入了却看到正常响应,
		// 然后把「没复现」记成结论 —— 那是最坏的一种沉默。
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

// matches —— 这条路径是否落在这一发故障的射程里。空前缀 = 全部。
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

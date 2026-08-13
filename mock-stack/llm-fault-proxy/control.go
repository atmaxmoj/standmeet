// control.go —— 装/卸/看故障的三个 HTTP 端点。跟 mail mock 的 /__mock/smtp/* 同形。

package main

import (
	"encoding/json"
	"net/http"
)

// armBody —— POST /__mock/llm/fail 的入参。
//
// times 省略 = 一直生效(直到 reset),模拟「provider 持续限流」;给了数字就只生效那么多次,
// 用来驱「退避之后第二次成功」这类走向。
type armBody struct {
	Mode              string `json:"mode"`
	Times             int    `json:"times"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
	MaxTokens         int    `json:"max_tokens"`
}

func (s *server) arm(w http.ResponseWriter, r *http.Request) {
	var in armBody
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if in.Mode != modeRateLimit && in.Mode != modeClampTokens {
		// 未知 mode 直接拒。默默当成「不注入」会让驱动的人以为注入了却看到正常响应,
		// 然后把「没复现」记成结论 —— 那是最坏的一种沉默。
		http.Error(w, "mode must be "+modeRateLimit+" or "+modeClampTokens, http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.fault = &fault{
		Mode: in.Mode, Times: in.Times, Sticky: in.Times <= 0,
		RetryAfterSeconds: in.RetryAfterSeconds, MaxTokens: in.MaxTokens,
	}
	s.mu.Unlock()
	s.log.Info("fault armed", "mode", in.Mode, "times", in.Times,
		"retry_after", in.RetryAfterSeconds, "max_tokens", in.MaxTokens)
	writeJSON(w, map[string]string{"armed": in.Mode})
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

// oauth_program.go —— 连接流（#155 §8 区 D）用的可编程 OAuth 控制面。GET 触发（spec 受 eslint 限制
// 不发 POST），编程下一次 dance 的结局 + 读回记录：
//
//	GET /__mock/oauth/program?outcome=deny|token_invalid_client|state_mismatch|network_fail|authorize
//	GET /__mock/oauth/reset            —— 清 outcome + 记录 + token 计数
//	GET /__mock/oauth/last_authorize   —— {scopes:[...]} 上次 authorize 收到的 scope 子集
//	GET /__mock/oauth/token_call_count —— {count} token 端点命中次数（静默刷新断言）
//
// 复用 gcalState（同一个 mock OAuth provider）；authorize/token 处理器按 oauthOutcome 走分支。

package main

import (
	"encoding/json"
	"net/http"
)

func (s *server) serveOAuthProgram(w http.ResponseWriter, r *http.Request) {
	outcome := r.URL.Query().Get("outcome")
	s.withState(func(st *gcalState) { st.oauthOutcome = outcome })
	writeOK(s.log, w)
}

func (s *server) serveOAuthRecordReset(w http.ResponseWriter, _ *http.Request) {
	s.withState(func(st *gcalState) {
		st.oauthOutcome = ""
		// lastAuthScopes 不在这清：它按 client_id 隔离，每次 dance 覆写自己那个 key，清空反而会被
		// 并行别的 spec 的 reset 擦掉本测试刚记的记录（跨 worker 竞争）。全量 mock reset 仍会清。
		st.tokenCallCount = 0
	})
	writeOK(s.log, w)
}

type lastAuthorizeResponse struct {
	Scopes []string `json:"scopes"`
}

func (s *server) serveOAuthLastAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	out := []string{}
	s.withState(func(st *gcalState) { out = append(out, st.lastAuthScopes[clientID]...) })
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(lastAuthorizeResponse{Scopes: out}); err != nil {
		s.log.Warn("write last_authorize", logErrKey, err)
	}
}

func (s *server) serveOAuthTokenCallCount(w http.ResponseWriter, _ *http.Request) {
	var n int
	s.withState(func(st *gcalState) { n = st.tokenCallCount })
	writeTokenCount(s.log, w, tokenCountResponse{Count: n})
}

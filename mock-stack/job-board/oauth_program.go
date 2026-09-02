// oauth_program.go —— the programmable OAuth control plane used by the connect flow (#155 §8 zone D). GET-triggered (specs are
// restricted by eslint from sending POST), programs the outcome of the next dance + reads back the record:
//
//	GET /__mock/oauth/program?outcome=deny|token_invalid_client|state_mismatch|network_fail|authorize
//	                                 |refresh_omit_scope  —— the refresh response omits `scope` (RFC allows this)
//	GET /__mock/oauth/reset            —— clears outcome + the record + the token count
//	GET /__mock/oauth/last_authorize   —— {scopes:[...]} the scope subset the last authorize received
//	GET /__mock/oauth/token_call_count —— {count} number of hits on the token endpoint (for a silent-refresh assertion)
//
// Reuses gcalState (the same mock OAuth provider); the authorize/token handlers branch on oauthOutcome.

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
		// lastAuthScopes is NOT cleared here: it's isolated by client_id, each dance overwrites its own key,
		// so clearing it here would let a parallel spec's reset wipe the record this test just made (cross-worker race). A full mock reset still clears it.
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

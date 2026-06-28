// sendgrid.go —— SendGrid-style 发信 mock（#155 §8 openapi-mail 契约用）。跟 /__mock/gcal/* 同构：
//   POST /__mock/sendgrid/mail/send   —— 真发信端（openapi runtime 实打实 POST 这里）；录 body。
//   GET  /__mock/sendgrid/sent        —— 读录到的所有 send（断 request JSONata 构造的形状）。
//   POST /__mock/sendgrid/fail        —— 让下 N 次 send 返指定 status（5xx 降级 / 4xx 拒）。
//   POST /__mock/sendgrid/reset       —— 清空。
// 一个 mock 面同时承 API（backend 容器内经 service-name 打）+ 控制（e2e 经 localhost 读）。

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
)

// sendgridState —— 录到的发信 + 失败注入。
type sendgridState struct {
	sent          []sentMail
	failStatus    int
	failRemaining int
	mu            sync.Mutex
}

// sentMail —— 一封录到的 send：归一字段（to/subject/text）+ 原样 SaaS body（断嵌套构造）。
type sentMail struct {
	Raw     sendGridBody `json:"raw"`
	Subject string       `json:"subject"`
	Text    string       `json:"text"`
	To      []string     `json:"to"`
}

// sendGridBody —— SendGrid /mail/send 的请求体（request JSONata 构造出的嵌套形状）。
type sendGridBody struct {
	Subject          string              `json:"subject"`
	Personalizations []sgPersonalization `json:"personalizations"`
	Content          []sgContent         `json:"content"`
}

type sgPersonalization struct {
	To []sgEmail `json:"to"`
}

type sgEmail struct {
	Email string `json:"email"`
}

type sgContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

func (s *server) withSendGrid(f func(*sendgridState)) {
	s.sendgrid.mu.Lock()
	defer s.sendgrid.mu.Unlock()
	f(&s.sendgrid)
}

// serveSendGridSend —— 发信端。失败注入命中 → 返注入 status；否则录 body + 202 {message_id}。
func (s *server) serveSendGridSend(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	if status := s.takeSendFail(); status != 0 {
		http.Error(w, `{"error":"injected provider failure"}`, status)
		return
	}
	var b sendGridBody
	if uerr := json.Unmarshal(body, &b); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	var id string
	s.withSendGrid(func(st *sendgridState) {
		id = fmt.Sprintf("sg-%d", len(st.sent)+1)
		st.sent = append(st.sent, sentMail{
			Raw: b, Subject: b.Subject, Text: firstContentValue(b), To: recipientEmails(b),
		})
	})
	writeSendGridAccepted(s.log, w, id)
}

// takeSendFail —— 下次 send 该返的注入 status（0 = 不注入）；命中则递减 remaining（-1 不减）。
func (s *server) takeSendFail() int {
	var status int
	s.withSendGrid(func(st *sendgridState) {
		if st.failRemaining == 0 {
			return
		}
		status = st.failStatus
		if st.failRemaining > 0 {
			st.failRemaining--
		}
	})
	return status
}

func recipientEmails(b sendGridBody) []string {
	out := make([]string, 0, len(b.Personalizations))
	for _, p := range b.Personalizations {
		for _, e := range p.To {
			out = append(out, e.Email)
		}
	}
	return out
}

func firstContentValue(b sendGridBody) string {
	if len(b.Content) == 0 {
		return ""
	}
	return b.Content[0].Value
}

type sentListResponse struct {
	Sent []sentMail `json:"sent"`
}

// serveSendGridSent —— 读录到的所有 send。
func (s *server) serveSendGridSent(w http.ResponseWriter, _ *http.Request) {
	var resp sentListResponse
	s.withSendGrid(func(st *sendgridState) {
		resp.Sent = append([]sentMail{}, st.sent...)
	})
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		s.log.Warn("write sendgrid sent", logErrKey, err)
	}
}

type sendFailRequest struct {
	Status int `json:"status"`
	Times  int `json:"times"`
}

// serveSendGridFail —— 武装失败注入（下 Times 次 send 返 Status）。
func (s *server) serveSendGridFail(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req sendFailRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.withSendGrid(func(st *sendgridState) {
		st.failStatus = req.Status
		st.failRemaining = req.Times
	})
	writeOK(s.log, w)
}

// serveSendGridReset —— 清空录到的 send + 失败注入。
func (s *server) serveSendGridReset(w http.ResponseWriter, _ *http.Request) {
	s.withSendGrid(func(st *sendgridState) {
		st.sent = nil
		st.failStatus = 0
		st.failRemaining = 0
	})
	writeOK(s.log, w)
}

func writeSendGridAccepted(log *slog.Logger, w http.ResponseWriter, messageID string) {
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusAccepted)
	if err := json.NewEncoder(w).Encode(map[string]string{"message_id": messageID}); err != nil {
		log.Warn("write sendgrid accepted", logErrKey, err)
	}
}

// mailapi.go —— happy-matrix combo 4（openapi mail，bearer）的「假 mail SaaS」落点：POST /__mock/
// mailapi/send {to,subject,text} → mock 经 SMTP 把信转投给 mail-mock（前置 mailpit）。这样经 openapi
// mail 连接器发出的信，消费侧（expectMailSent → 查 Mailpit）能查到，跟 SMTP 协议连接器归一到同一
// 个收件箱。仅 dev/e2e 用。

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/smtp"
	"os"
)

type mailAPIRequest struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

// serveMailAPISend —— 收 HTTP 发信请求 → 经 SMTP 转投 mail-mock（→ Mailpit）。202 表示已接受。
func (s *server) serveMailAPISend(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req mailAPIRequest
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if serr := relayToMailpit(&req); serr != nil {
		s.log.Warn("mailapi relay", logErrKey, serr)
		http.Error(w, `{"error":"relay failed"}`, http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusAccepted)
	if _, werr := w.Write([]byte(`{"id":"mailapi-` + randomHex(mockEventIDLen) + `"}`)); werr != nil {
		s.log.Warn("mailapi write", logErrKey, werr)
	}
}

// relayToMailpit —— 把请求拼成一封信经 SMTP 投给 mail-mock（地址可经 MAILAPI_SMTP_ADDR 覆盖）。
func relayToMailpit(req *mailAPIRequest) error {
	addr := os.Getenv("MAILAPI_SMTP_ADDR")
	if addr == "" {
		addr = "mail-mock:1025"
	}
	from := "noreply@standmeet.test"
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n",
		from, req.To, req.Subject, req.Text)
	if err := smtp.SendMail(addr, nil, from, []string{req.To}, []byte(msg)); err != nil {
		return fmt.Errorf("smtp relay to %s: %w", addr, err)
	}
	return nil
}

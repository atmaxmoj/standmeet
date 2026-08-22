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

// serveMailAPISendForm —— **一个只收表单编码的假 vendor**（F-C-54）。
//
// 真世界里这不是少数派：Mailgun / Twilio / Stripe 的发信、发短信、收款端点都是
// `application/x-www-form-urlencoded` 或 `multipart/form-data`，**JSON body 会被整个忽略**。
// 拿真 Mailgun 试过：同一个端点、同一把 key，body 换成 JSON → `400 {"message":"from parameter
// is missing"}` —— 它只是没看见那些字段。
//
// 这个替身以前的每一个假 vendor 端点都只说 JSON，于是「产品写死发 JSON」这件事在测试里
// 永远发生不了（[[stand-in-is-politer-than-reality]]）。这条路存在的唯一目的，就是让它发生。
//
// 答法逐字照抄真 Mailgun：认得出表单就照发并在 **body** 里回 id；认不出（比如收到 JSON）就回
// 那句 `from parameter is missing` —— 那句话本身就是这条缺陷在真环境里的样子。
func (s *server) serveMailAPISendForm(w http.ResponseWriter, r *http.Request) {
	if perr := r.ParseForm(); perr != nil {
		http.Error(w, `{"message":"could not parse form"}`, http.StatusBadRequest)
		return
	}
	if r.FormValue("from") == "" {
		w.Header().Set("Content-Type", jsonMIME)
		w.WriteHeader(http.StatusBadRequest)
		if _, werr := w.Write([]byte(`{"message":"from parameter is missing"}`)); werr != nil {
			s.log.Warn("mailapi form write", logErrKey, werr)
		}
		return
	}
	req := mailAPIRequest{
		To: r.FormValue("to"), Subject: r.FormValue("subject"), Text: r.FormValue("text"),
	}
	if serr := relayToMailpit(&req); serr != nil {
		s.log.Warn("mailapi form relay", logErrKey, serr)
		http.Error(w, `{"error":"relay failed"}`, http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", jsonMIME)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write([]byte(`{"id":"<form-` + randomHex(mockEventIDLen) +
		`@mock.test>","message":"Queued. Thank you."}`)); werr != nil {
		s.log.Warn("mailapi form write", logErrKey, werr)
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

// mailapi.go —— the "fake mail SaaS" landing spot for happy-matrix combo 4 (openapi mail,
// bearer): POST /__mock/mailapi/send {to,subject,text} → the mock relays the message over
// SMTP to mail-mock (fronting mailpit). This way, mail sent through the openapi mail
// connector can be found by the consumer side (expectMailSent → check Mailpit), unified into
// the same inbox as the SMTP-protocol connector. dev/e2e only.

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

// serveMailAPISend —— receives an HTTP send request → relays over SMTP to mail-mock
// (→ Mailpit). 202 means accepted.
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

// serveMailAPISendForm —— **a fake vendor that only accepts form encoding** (F-C-54).
//
// This isn't a minority case in the real world: Mailgun / Twilio / Stripe's send-mail,
// send-SMS, and take-payment endpoints are all `application/x-www-form-urlencoded` or
// `multipart/form-data` — **a JSON body gets ignored entirely**. Tried against real
// Mailgun: same endpoint, same key, body switched to JSON → `400 {"message":"from
// parameter is missing"}` — it simply never saw those fields.
//
// Every fake vendor endpoint this stand-in used to have only spoke JSON, so "the product
// hardcoded sending JSON" could never happen in tests
// ([[stand-in-is-politer-than-reality]]). This path exists for the sole purpose of making
// that happen.
//
// The response copies real Mailgun verbatim: recognize a form and relay it, echoing the
// id back in **body**; fail to recognize it (e.g. receives JSON instead) and it replies
// with that same `from parameter is missing` — that sentence is itself what this defect
// looks like in the real environment.
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

// relayToMailpit —— assembles the request into an email and delivers it to mail-mock over
// SMTP (address overridable via MAILAPI_SMTP_ADDR).
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

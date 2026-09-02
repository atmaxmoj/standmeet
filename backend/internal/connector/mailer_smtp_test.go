package connector

import (
	"context"
	"strings"
	"testing"
	"time"
)

// buildMessage is the RFC822 rendering of a sent message. This locks down two things: ① the
// structure (headers + blank line + body) ② header-injection protection (CR/LF in a
// visitor-supplied name / subject must be stripped, otherwise an extra header like Bcc could
// be injected). e2e verifies the real send loop end-to-end (mail-connector.spec); injection is
// a security property, locked down here with a pure-logic unit test.

const (
	testSMTPPort  = 587
	wantHeaderSep = 5 // 6 header lines → 5 CRLF separators in the header block
	testYear      = 2026
	testDay       = 11
	testHour      = 12
)

func testConfig() Config {
	return Config{
		Host: "smtp.example.com", Port: testSMTPPort,
		FromAddress: "owner@example.com", FromName: "Owner",
	}
}

func fixedTime() time.Time {
	return time.Date(testYear, time.June, testDay, testHour, 0, 0, 0, time.UTC)
}

func TestBuildMessageStructure(t *testing.T) {
	t.Parallel()
	cfg := testConfig()
	msg := Message{
		ToAddress: "v@x.com", ToName: "Visitor",
		Subject: "Your code", Body: "code: inv-abc123",
	}
	raw := string(buildMessage(&cfg, &msg, fixedTime()))
	wants := []string{
		"From: Owner <owner@example.com>\r\n",
		"To: Visitor <v@x.com>\r\n",
		"Subject: Your code\r\n",
		"MIME-Version: 1.0\r\n",
		"\r\n\r\ncode: inv-abc123",
	}
	for _, w := range wants {
		if !strings.Contains(raw, w) {
			t.Fatalf("message missing %q\n--- got ---\n%s", w, raw)
		}
	}
}

func TestBuildMessageStripsHeaderInjectionFromName(t *testing.T) {
	t.Parallel()
	cfg := testConfig()
	msg := Message{
		ToAddress: "v@x.com",
		ToName:    "Evil\r\nBcc: attacker@evil.com",
		Subject:   "hi",
		Body:      "body",
	}
	raw := string(buildMessage(&cfg, &msg, fixedTime()))
	// The criterion for injection is "a new header line starting after a line break appeared",
	// not the substring "Bcc:" — once CR/LF is stripped, "Bcc:" left sitting inside the To
	// line's text is harmless.
	if strings.Contains(raw, "\r\nBcc:") {
		t.Fatalf("CR/LF in display name leaked an injected header:\n%s", raw)
	}
	headerBlock := strings.SplitN(raw, "\r\n\r\n", 2)[0]
	if strings.Count(headerBlock, "\r\n") != wantHeaderSep {
		t.Fatalf("expected exactly 6 header lines, got header block:\n%s", headerBlock)
	}
}

func TestBuildMessageStripsHeaderInjectionFromSubject(t *testing.T) {
	t.Parallel()
	cfg := testConfig()
	msg := Message{ToAddress: "v@x.com", Subject: "ok\r\nBcc: attacker@evil.com", Body: "body"}
	raw := string(buildMessage(&cfg, &msg, fixedTime()))
	if strings.Contains(raw, "\r\nBcc:") {
		t.Fatalf("CR/LF in subject leaked an injected header:\n%s", raw)
	}
}

func TestSendRejectsIncompleteConfig(t *testing.T) {
	t.Parallel()
	cfg := Config{Port: testSMTPPort} // no host / from
	msg := Message{ToAddress: "v@x.com", Subject: "s", Body: "b"}
	if err := Send(context.Background(), &cfg, &msg, fixedTime()); err == nil {
		t.Fatal("expected error for incomplete config, got nil")
	}
}

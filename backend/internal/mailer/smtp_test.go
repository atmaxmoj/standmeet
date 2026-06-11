package mailer

import (
	"strings"
	"testing"
	"time"
)

// buildMessage 是发信的 RFC822 渲染。这里锁两件事:① 结构(headers + 空行 +
// body)② header 注入防护(访客提供的 name / subject 里的 CR/LF 必须被剥掉,
// 否则能注入 Bcc 等额外 header)。e2e 验真发送闭环(mail-connector.spec);
// 注入是安全属性,纯逻辑单测锁死。

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
	// 注入的判据是"出现了换行开头的新 header 行",不是子串 "Bcc:"——剥掉 CR/LF
	// 后 "Bcc:" 残留在 To 行文本里是无害的。
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
	if err := Send(&cfg, &msg, fixedTime()); err == nil {
		t.Fatal("expected error for incomplete config, got nil")
	}
}

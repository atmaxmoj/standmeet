// smtp.go —— minimal plaintext SMTP server. Reads the whole message (so a fault can
// key off its Subject), then either forwards it to the real Mailpit (normal) or drops
// the connection (armed) so the backend sees a retryable transport send failure.
// No STARTTLS/AUTH advertised → net/smtp stays plaintext (same as talking to Mailpit
// directly), which lets us read the Subject in the clear.

package main

import (
	"bufio"
	"bytes"
	"fmt"
	"net"
	"net/smtp"
	"strings"
)

func (s *server) startSMTP(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp listen %s: %w", addr, err)
	}
	s.log.Info("mail-mock smtp listening", "addr", addr)
	go s.acceptSMTP(ln)
	return nil
}

func (s *server) acceptSMTP(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go s.handleSMTP(conn)
	}
}

func (s *server) handleSMTP(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	br := bufio.NewReader(conn)
	w := func(line string) { _, _ = fmt.Fprintf(conn, "%s\r\n", line) }
	w("220 mail-mock ready")
	var from string
	var to []string
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.TrimSpace(line)
		verb := strings.ToUpper(cmd)
		switch {
		case strings.HasPrefix(verb, "EHLO"), strings.HasPrefix(verb, "HELO"):
			w("250 mail-mock") // single-line 250: no STARTTLS/AUTH advertised
		case strings.HasPrefix(verb, "MAIL FROM"):
			from = addrOf(cmd)
			w("250 OK")
		case strings.HasPrefix(verb, "RCPT TO"):
			to = append(to, addrOf(cmd))
			w("250 OK")
		case verb == "DATA":
			w("354 end with <CRLF>.<CRLF>")
			if !s.onData(br, from, to, w) {
				return // armed fault → connection dropped
			}
		case verb == "RSET":
			from, to = "", nil
			w("250 OK")
		case verb == "QUIT":
			w("221 bye")
			return
		case verb == "":
		default:
			w("250 OK") // tolerate NOOP and friends
		}
	}
}

// onData —— 读完整封信，按故障开关决定怎么答：
//
//	permanent          回一个 5xx（真中继拒收这一封时给的东西）。**连接不断**，
//	                   net/smtp 才能把回码带出来 —— 断线只剩一个传输错，没有码可分类。
//	其余（含 drop）      丢连接 → 后端看到可重试的传输失败。
func (s *server) onData(br *bufio.Reader, from string, to []string, w func(string)) bool {
	raw, subject := readMessage(br)
	if failing, mode := s.shouldFail(subject); failing {
		s.log.Info("mail-mock armed fault", "subject", subject, "mode", mode)
		return s.answerFault(mode, w)
	}
	if err := s.forward(from, to, raw); err != nil {
		s.log.Error("mail-mock forward to mailpit failed", "err", err)
		w("451 upstream unavailable")
		return true
	}
	w("250 OK queued")
	return true
}

// readMessage —— 收 DATA 直到单独一行 "."；顺手抓 Subject（首个匹配）。dot-unstuff。
func readMessage(br *bufio.Reader) ([]byte, string) {
	var buf bytes.Buffer
	subject := ""
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			break
		}
		t := strings.TrimRight(line, "\r\n")
		if t == "." {
			break
		}
		if strings.HasPrefix(t, "..") {
			t = t[1:]
		}
		if subject == "" && strings.HasPrefix(strings.ToLower(t), "subject:") {
			subject = strings.TrimSpace(t[len("subject:"):])
		}
		buf.WriteString(t)
		buf.WriteString("\r\n")
	}
	return buf.Bytes(), subject
}

// answerFault —— 按模式作答。permanent 给 5xx 并保持连接（回码要能被读到）；其余丢连接。
func (s *server) answerFault(mode string, w func(string)) bool {
	if mode != modePermanent {
		return false
	}
	w("550 5.1.1 no such user here")
	return true
}

// modePermanent —— 真中继永久拒收这一封时的那一类（地址不存在 / 被拒 / 超大）。
const modePermanent = "permanent"

// shouldFail —— 还有失败额度且 subject 匹配（match 为空=全配）→ 消耗一次、返回 true + 模式。
func (s *server) shouldFail(subject string) (bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fault.remaining <= 0 {
		return false, ""
	}
	if s.fault.subject != "" && !strings.Contains(subject, s.fault.subject) {
		return false, ""
	}
	s.fault.remaining--
	return true, s.fault.mode
}

func (s *server) forward(from string, to []string, raw []byte) error {
	if err := smtp.SendMail(s.upstream, nil, from, to, raw); err != nil {
		return fmt.Errorf("send to %s: %w", s.upstream, err)
	}
	return nil
}

// addrOf —— 从 "MAIL FROM:<a@b>" / "RCPT TO:<a@b>" 取尖括号里的地址（net/smtp 恒带尖括号）。
func addrOf(cmd string) string {
	i := strings.Index(cmd, "<")
	j := strings.LastIndex(cmd, ">")
	if i >= 0 && j > i {
		return cmd[i+1 : j]
	}
	return ""
}

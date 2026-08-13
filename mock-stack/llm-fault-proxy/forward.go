// forward.go —— 转发那一半:装了故障就按 mode 处理,没装就原样过。

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	modeRateLimit   = "ratelimit"
	modeClampTokens = "clamp_tokens"
)

func (s *server) forward(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	got := s.take()
	if got != nil && got.Mode == modeRateLimit {
		s.writeRateLimit(w, got)
		return
	}
	if got != nil && got.Mode == modeClampTokens {
		body = clampMaxTokens(body, got.MaxTokens, s.logClamp)
	}
	s.pipe(w, r, body)
}

// writeRateLimit —— 唯一伪造响应的地方。形状照真 provider:429 + `Retry-After` 秒数 +
// 一个 provider 风格的 JSON 体(有些客户端只读体不读头,两边都给才像真的)。
func (s *server) writeRateLimit(w http.ResponseWriter, f *fault) {
	secs := f.RetryAfterSeconds
	if secs <= 0 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"type":    "rate_limit_error",
			"message": "rate limit exceeded (injected by llm-fault-proxy)",
		},
	})
	s.log.Info("injected 429", "retry_after_seconds", secs)
}

func (s *server) logClamp(from, to int) {
	s.log.Info("clamped max_tokens", "from", from, "to", to)
}

// clampMaxTokens —— 把请求体的 max_tokens 改小。**只改这一个字段**,其余原样,因为要让真模型
// 在自己的正常路径上撞到长度上限。
//
// 解不开的 JSON 原样返回:代理不该因为看不懂一个请求就把它吃掉。看不懂就当没这回事转过去,
// 上游会给出它自己的判断 —— 那比代理在中间造一个错误更接近真相。
func clampMaxTokens(body []byte, to int, onClamp func(from, to int)) []byte {
	if to <= 0 {
		return body
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return body
	}
	from := 0
	if v, ok := payload["max_tokens"].(float64); ok {
		from = int(v)
	}
	payload["max_tokens"] = to
	out, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	onClamp(from, to)
	return out
}

// pipe —— 把请求原样送到上游,再把响应原样送回。**请求头整份带过去**(Authorization 在里面):
// 代理不解析、不存、不打印 key。
//
// 流式响应要**边收边写**并且每块都 Flush:agent loop 靠 SSE 一块块拿 token,攒完再发会把
// 「流式」变成「一次性」,那就把被测的时序改掉了。
func (s *server) pipe(w http.ResponseWriter, r *http.Request, body []byte) {
	url := strings.TrimSuffix(s.upstream, "/") + r.URL.Path
	if r.URL.RawQuery != "" {
		url += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, url, bytes.NewReader(body))
	if err != nil {
		http.Error(w, "build upstream request", http.StatusBadGateway)
		return
	}
	req.Header = r.Header.Clone()
	stripHopByHop(req.Header)
	req.ContentLength = int64(len(body))
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		s.log.Error("upstream", "err", err, "url", url)
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	// 转发成功也要留一行。**不留的话这份日志的沉默有两种意思** —— 「没有流量」和「转发正常」
	// 长得一模一样,而驱动的人正是靠它判断产品到底接上来没有。第一次用它我就差点据此断定
	// 「产品没走代理」,其实那一轮完全正常。
	s.log.Info("forwarded", "path", r.URL.Path, "status", resp.StatusCode)
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	streamCopy(w, resp.Body)
}

// stripHopByHop —— 逐跳头不能转发(RFC 9110 §7.6.1):它们描述的是**这一跳连接**,不是那份请求。
// Content-Length 也去掉 —— 长度由 req.ContentLength 说了算,两处各说一遍就有对不上的可能。
//
// **改它的理由是规范,不是诊断。** 2026-08-13 驱这个模块时上游出过一次
// `unexpected EOF`,我怀疑但**没有证据**是这里造成的;这次修正是因为一个代理本来就该这么做,
// 那次 EOF 治没治好,要下一轮真撞上才知道 —— 不把猜测记成结论。
func stripHopByHop(h http.Header) {
	for _, k := range []string{
		"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
		"Te", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length",
	} {
		h.Del(k)
	}
}

func copyHeaders(dst, src http.Header) {
	for k, vals := range src {
		for _, v := range vals {
			dst.Add(k, v)
		}
	}
}

func streamCopy(w http.ResponseWriter, src io.Reader) {
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

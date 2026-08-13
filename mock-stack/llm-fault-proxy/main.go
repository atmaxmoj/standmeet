// llm-fault-proxy —— 坐在**真** LLM provider 前面的故障注入代理。
//
// 为什么它存在:agent-loop-robustness 的 Real dep 写的是「一个真 provider,或者它前面一个能
// 注入限流响应和重试提示的代理」。仓库里已有的 llm-gateway 走的是另一条路 —— 它**替换掉**
// 模型,按关键词发脚本。那条路对「UI 怎么显示」够用,对这个模块不够:要验的正是**真模型在
// 异常下的行为**(它自己会不会重试、会不会把半句话当完成品交出去),换成脚本就把被测对象换掉了。
//
// 形状照 mock-stack/mail 那个(它是 mailpit 前面的 SMTP 故障 mock),不另发明:
//
//	HTTP  :9500
//	  /v1/*                    —— 原样转发到 UPSTREAM_BASE_URL(真 provider)
//	  POST /__mock/llm/fail    —— 装一发故障 {mode, times, retry_after_seconds, max_tokens}
//	  POST /__mock/llm/reset   —— 卸掉
//	  GET  /__mock/llm/state   —— 还剩几发(给驱动的人看,不给断言用)
//
// **两种 mode,性质不一样,别混:**
//
//   - `ratelimit` —— 代理自己回 429 + `Retry-After`。**这是伪造的**,因为没法让真 provider
//     按需限流。伪造的只有那一个响应;被测的是 backend 的退避行为,那部分是真的。
//
//   - `clamp_tokens` —— **什么都不伪造**。把请求体里的 `max_tokens` 改小再转发,于是**真模型**
//     真的写到一半被截断,回来的 stop reason 是它自己给的。check 3 要看的「长度截断之后这一轮
//     还读不读得下去」,只有这样才是在看真东西。
//
// 上游地址从 UPSTREAM_BASE_URL 读,**key 不碰** —— 原样透传请求头。代理不存、不看、不记 key。
package main

import (
	"log/slog"
	"net/http"
	"os"
	"sync"
)

func main() {
	upstream := os.Getenv("UPSTREAM_BASE_URL")
	if upstream == "" {
		slog.Error("UPSTREAM_BASE_URL is required — this proxy has nothing to sit in front of")
		os.Exit(2)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "9500"
	}
	srv := &server{upstream: upstream, log: slog.Default()}
	mux := http.NewServeMux()
	mux.HandleFunc("/__mock/llm/fail", srv.arm)
	mux.HandleFunc("/__mock/llm/reset", srv.reset)
	mux.HandleFunc("/__mock/llm/state", srv.state)
	mux.HandleFunc("/", srv.forward)
	srv.log.Info("llm-fault-proxy up", "port", port, "upstream", upstream)
	if err := http.ListenAndServe(":"+port, mux); err != nil { //nolint:gosec // mock, no timeouts needed
		srv.log.Error("listen", "err", err)
		os.Exit(1)
	}
}

// server —— 上游地址 + 装着的那一发故障。
type server struct {
	log      *slog.Logger
	upstream string
	mu       sync.Mutex
	fault    *fault
}

// fault —— 装上的故障。times 省略 = 一直有效(直到 reset),模拟「provider 持续限流」。
type fault struct {
	Mode string `json:"mode"`
	// Times —— 还剩几次生效。0 且 Sticky 为假 = 已用完。
	Times int `json:"times"`
	// Sticky —— 请求里没给 times:一直生效。
	Sticky bool `json:"sticky"`
	// RetryAfterSeconds —— ratelimit 模式下写进 `Retry-After` 头的秒数。
	RetryAfterSeconds int `json:"retry_after_seconds"`
	// MaxTokens —— clamp_tokens 模式下把请求体的 max_tokens 改成这个值。
	MaxTokens int `json:"max_tokens"`
}

// take —— 取出当前该生效的故障并扣一次。没装或已用完返回 nil。
func (s *server) take() *fault {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fault == nil {
		return nil
	}
	got := *s.fault
	if !s.fault.Sticky {
		s.fault.Times--
		if s.fault.Times <= 0 {
			s.fault = nil
		}
	}
	return &got
}

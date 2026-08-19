// fault-proxy —— 坐在**任何一个真上游**前面的故障注入代理。
//
// 为什么它存在:好几个模块的 Real dep 都写着「一个真服务,或者它前面一个能注入故障的代理」——
// agent-loop-robustness 要的是真 LLM provider 前面的限流/截断,corpus-acl-editing check 6 要的是
// **单独一个 admin 接口**加载失败(整栈停机是另一回事,那条已经驱过并撞出 F-N-2)。
// 仓库里已有的 llm-gateway 走的是另一条路 —— 它**替换掉**模型,按关键词发脚本。那条路对
// 「UI 怎么显示」够用,对这些模块不够:要验的正是**真上游在异常下的行为**,换成脚本就把被测对象
// 换掉了。
//
// **它以前叫 llm-fault-proxy,只会挡 LLM。** 第二个用途来的时候,抄一份 api-fault-proxy 是
// 最省事的做法,也是错的:两份代码日后各自漂移,而它们唯一的差别只是**上游地址**和
// **要挡哪条路径**——那是配置,不是新的一类东西。
//
// 形状照 mock-stack/mail 那个(它是 mailpit 前面的 SMTP 故障 mock),不另发明:
//
//	HTTP  :9500(PORT 可改)
//	  /*                          —— 原样转发到 UPSTREAM_BASE_URL
//	  POST /__mock/fault/arm      —— 装一发故障 {mode, path_prefix, times, ...}
//	  POST /__mock/fault/reset    —— 卸掉
//	  GET  /__mock/fault/state    —— 还剩几发(给驱动的人看,不给断言用)
//
// **三种 mode,性质不一样,别混:**
//
//   - `ratelimit` —— 代理自己回 429 + `Retry-After`。**这是伪造的**,因为没法让真上游按需限流。
//     伪造的只有那一个响应;被测的是调用方的退避行为,那部分是真的。
//
//   - `clamp_tokens` —— **什么都不伪造**。把请求体里的 `max_tokens` 改小再转发,于是**真模型**
//     真的写到一半被截断,回来的 stop reason 是它自己给的。
//
//   - `http_error` —— 代理自己回一个状态码(默认 500)。给「某一个接口挂了,界面怎么说」用。
//     同样是伪造那一个响应,被测的是界面。
//
// **`path_prefix` 是这三种 mode 共用的过滤器**,而它正是「窄故障」和「整栈停机」的分界:
// 不给 = 挡住经过的一切;给了 = 只挡以它开头的路径,**其余照常转发**。窄故障要的是
// 「这一块加载失败时,页面说它加载不了,而不是穿上空状态的衣服」—— 如果整个后端都躺下,
// 那验的是另一条路。
//
// 上游地址从 UPSTREAM_BASE_URL 读,**凭据不碰** —— 原样透传请求头。代理不存、不看、不记。
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
	mux.HandleFunc("/__mock/fault/arm", srv.arm)
	mux.HandleFunc("/__mock/fault/reset", srv.reset)
	mux.HandleFunc("/__mock/fault/state", srv.state)
	mux.HandleFunc("/", srv.forward)
	srv.log.Info("fault-proxy up", "port", port, "upstream", upstream)
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

// fault —— 装上的故障。times 省略 = 一直有效(直到 reset),模拟「上游持续故障」。
type fault struct {
	Mode string `json:"mode"`
	// PathPrefix —— 只挡以它开头的请求路径。空 = 挡住经过的一切。
	// 这一格是「窄故障」的全部:界面上别的块照常加载,只有一块坏了。
	PathPrefix string `json:"path_prefix"`
	// Times —— 还剩几次生效。0 且 Sticky 为假 = 已用完。
	Times int `json:"times"`
	// Sticky —— 请求里没给 times:一直生效。
	Sticky bool `json:"sticky"`
	// RetryAfterSeconds —— ratelimit 模式下写进 `Retry-After` 头的秒数。
	RetryAfterSeconds int `json:"retry_after_seconds"`
	// MaxTokens —— clamp_tokens 模式下把请求体的 max_tokens 改成这个值。
	MaxTokens int `json:"max_tokens"`
	// Status —— http_error 模式下回的状态码。0 = 500。
	Status int `json:"status"`
	// DelayMS —— slow 模式下把这条路径扣住多少毫秒再转发。0 = defaultSlowMS。
	DelayMS int `json:"delay_ms"`
}

// take —— 取出**对这条路径**该生效的故障并扣一次。没装 / 路径不匹配 / 已用完返回 nil。
//
// 路径不匹配时**不扣次数**:`times: 1` 的意思是「让那一个接口失败一次」,不是「让下一个
// 经过的任何请求失败一次」。页面加载会并发打好几个接口,按到达顺序扣次数的话,
// 到底哪一个中招取决于竞态 —— 那种红是[[red-in-the-wrong-place]]。
func (s *server) take(path string) *fault {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fault == nil || !s.fault.matches(path) {
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

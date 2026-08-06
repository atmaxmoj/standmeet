// recorder.go —— 记下"这一趟请求是谁发来的、发给谁"，让 e2e 断言得了 **which upstream**。
//
// 起因:一个 owner 手上开始有多份 provider 凭据(#6)之后,"这一轮走的是哪个 provider"成了
// 要断言的东西 —— 而这个 mock 原来对调用方一无所知:不看 Authorization、不记 path,
// /__mock/inference/state 只吐已注册的脚本。byoai-chat.spec 能过是因为当时只有一个备选
// (把访客的 endpoint 指过来,回包回来了就说明走了它);三个 provider 之后这招失效。
//
// **按 tag 查,不给"最后一次"。** 全局的 last-request 在并行 worker 下就是共享态:另一条
// spec 的请求会把你的盖掉,而它红得像你的功能坏了。所以这里存一个环,查询按**请求文本里的
// 那个 tag** 找最近一条 —— tag 就是 mock-llm-script.ts 已经埋进消息里的唯一串,调用方
// 本来就有,不用另注册一次。
//
// **凭据只留前缀。** 断言"用的是哪把 key"需要能区分,不需要看见 key;记全量等于把密钥写进
// e2e 日志。前缀 8 个字符足够区分两把测试用的假 key,又不构成泄漏。
package main

import (
	"net/http"
	"strings"
	"sync"
)

// recordRing —— 保留最近这么多条。够几条 spec 并行跑还能各自找到自己那条;
// 再多没有意义(查询总是按 tag 找最近的一条)。
const recordRing = 64

// authPrefixLen —— 凭据只留这么长的前缀(能区分,不能还原)。
const authPrefixLen = 8

// RequestRecord —— 一次 /v1/messages 的可断言事实。
type RequestRecord struct {
	Path       string `json:"path"`        // 打到哪个路径(不同 provider 可以配不同 base path)
	Model      string `json:"model"`       // 请求里的 model —— 最直接的"哪份配置生效了"
	AuthPrefix string `json:"auth_prefix"` // 凭据前 8 个字符
	Stream     bool   `json:"stream"`
	Found      bool   `json:"found"` // 查不到时为 false,让调用方分得清"没记到"和"记到了但字段是空"
}

// recorder —— 请求环。写多读少,一把锁足够。
type recorder struct {
	mu   sync.Mutex
	ring []RequestRecord
	text []string // 与 ring 平行:那一条的 marker 文本(查询按它匹配)
}

func newRecorder() *recorder {
	return &recorder{
		ring: make([]RequestRecord, 0, recordRing),
		text: make([]string, 0, recordRing),
	}
}

// record —— 记一条。满了就丢最旧的。
func (rec *recorder) record(r RequestRecord, markerText string) {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.ring) == recordRing {
		rec.ring = rec.ring[1:]
		rec.text = rec.text[1:]
	}
	rec.ring = append(rec.ring, r)
	rec.text = append(rec.text, markerText)
}

// findByTag —— 文本里含 tag 的**最近**一条。tag 为空 → 不匹配任何东西
// (空串会 Contains 上一切,那正是"全局 last"的坑,这里明确堵掉)。
func (rec *recorder) findByTag(tag string) RequestRecord {
	if tag == "" {
		return RequestRecord{}
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for i := len(rec.ring) - 1; i >= 0; i-- {
		if strings.Contains(rec.text[i], tag) {
			hit := rec.ring[i]
			hit.Found = true
			return hit
		}
	}
	return RequestRecord{}
}

// recordFrom —— 从 HTTP 请求 + 解出来的 body 折一条记录。
// 凭据两种头都看:Anthropic 用 x-api-key,OpenAI-compat 用 Authorization: Bearer。
func recordFrom(r *http.Request, req *MessagesReq) RequestRecord {
	return RequestRecord{
		Path:       r.URL.Path,
		Model:      req.Model,
		AuthPrefix: authPrefix(r),
		Stream:     req.Stream,
	}
}

func authPrefix(r *http.Request) string {
	raw := r.Header.Get("x-api-key")
	if raw == "" {
		raw = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if len(raw) > authPrefixLen {
		return raw[:authPrefixLen]
	}
	return raw
}

// serveLastRequest —— GET /__mock/inference/last_request?tag=xxx
func (s *server) serveLastRequest(w http.ResponseWriter, r *http.Request) {
	writeJSON(s.log, w, s.rec.findByTag(r.URL.Query().Get("tag")))
}

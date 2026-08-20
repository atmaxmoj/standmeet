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
	// Contains —— `?contains=` 给了的话:那一趟请求的**全部消息文本**里有没有它。
	//
	// 为什么值得单开一格:有些判据问的是「这件事到底有没有进模型的上下文」——
	// 比如访客在卡上取消了一场会,agent 下一轮该知道(F-B-9)。那件事在屏幕上看不见,
	// 在库里也看不见,唯一的现场就是**发给模型的那一份消息**。而这个 recorder 早就把
	// 全文留着了(markerText),只是没让人问。
	Contains bool `json:"contains"`
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
// needle 为空 → Contains 恒 false（空串会 Contains 上一切，跟 tag 那条同一个坑）。
func (rec *recorder) findByTag(tag, needle string) RequestRecord {
	if tag == "" {
		return RequestRecord{}
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for i := len(rec.ring) - 1; i >= 0; i-- {
		if strings.Contains(rec.text[i], tag) {
			hit := rec.ring[i]
			hit.Found = true
			hit.Contains = needle != "" && strings.Contains(rec.text[i], needle)
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

// clear —— 倒掉记录环。
//
// 为什么必须有：脚本 tag 是 `<testId>-<n>`，**同一条 spec 每次跑都是同一个 tag** ——
// 而这个环跨 run 活着。于是「上一次跑（代码是好的）留下的那条记录」会被这一次的查询
// 命中，判据从此判不了负：我在这条缺陷上就撞见过一次「把修好的地方拆掉，用例照样绿」。
func (rec *recorder) clear() {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	rec.ring = rec.ring[:0]
	rec.text = rec.text[:0]
}

// serveResetRequests —— POST /__mock/inference/reset_requests
func (s *server) serveResetRequests(w http.ResponseWriter, _ *http.Request) {
	s.rec.clear()
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

// serveLastRequest —— GET /__mock/inference/last_request?tag=xxx[&contains=yyy]
func (s *server) serveLastRequest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	writeJSON(s.log, w, s.rec.findByTag(q.Get("tag"), q.Get("contains")))
}

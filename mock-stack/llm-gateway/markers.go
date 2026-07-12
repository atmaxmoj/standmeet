// markers.go —— e2e 在 visitor 问句里嵌延时 marker,给「turn 内瞬时 UI」
// (throbber / thinking 轮换)留出能在 DOM 里断言的时间窗。
//
//	[[think:N]]       —— 这一 turn 跳过所有 tool,sleep N ms 再出最终答案。
//	                     期间没有 tool 在跑 → 前端显 thinking 词库轮换那条。
//	[[slow-final:N]]  —— 正常 tool flow(search→read),但出最终答案前 sleep
//	                     N ms。期间 corpus_read 的 throbber("reading X")挂着。
//
// marker 在 visitor 问句里 → 请求级,只控这一 turn 的时序,不跨 spec。marker
// 不进 search query(makeSearchCall 用 stripMarkers 剥掉),也由前端正常显示在
// 问句里(测试无所谓)。
//
// script keyword —— 脚本(next_tool/next_reply/…)的隔离靠 test 在消息里嵌一个
// 唯一 keyword `[[s:testId-yyy]]`(见 e2e mock-llm-script fixture);mock 按
// Contains 匹配注册的 keyword(script.go)。这里只负责把 `[[s:…]]` 从 search
// query 里剥掉,别让 keyword 污染 corpus_search 命中。匹配用原文,不做提取。
package main

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var delayMarkerRe = regexp.MustCompile(`\[\[(think|slow-final):(\d+)\]\]`)

// scriptKeyRe —— the `[[s:KEY]]` wrapper a test embeds to carry its script
// keyword. Stripped from the corpus_search query so the keyword never leaks into
// the search (matching itself uses the raw request text, in script.go).
var scriptKeyRe = regexp.MustCompile(`\[\[s:[^\]]+\]\]`)

// scriptKeyTokens —— all `[[s:…]]` wrappers in a stream turn's text, joined.
// The mock RETAINS these from each visitor turn so backend-initiated generate
// calls (GhostPolicy, summarize) — which are built from derived content and
// don't carry the visitor message — can still be matched to this turn's
// registrations (script.go, via lastKeys). Returns "" if none.
func scriptKeyTokens(text string) string {
	return strings.Join(scriptKeyRe.FindAllString(text, -1), " ")
}

func markerDelay(text, kind string) time.Duration {
	for _, m := range delayMarkerRe.FindAllStringSubmatch(text, -1) {
		if m[1] == kind {
			ms, _ := strconv.Atoi(m[2])
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 0
}

func stripMarkers(text string) string {
	text = delayMarkerRe.ReplaceAllString(text, "")
	text = scriptKeyRe.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

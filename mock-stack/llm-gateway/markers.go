// markers.go —— e2e 在 visitor 问句里嵌延时 marker,给「turn 内瞬时 UI」
// (throbber / thinking 轮换)留出能在 DOM 里断言的时间窗。
//
//	[[think:N]]       —— 这一 turn 跳过所有 tool,sleep N ms 再出最终答案。
//	                     期间没有 tool 在跑 → 前端显 thinking 词库轮换那条。
//	[[slow-final:N]]  —— 正常 tool flow(search→read),但出最终答案前 sleep
//	                     N ms。期间 corpus_read 的 throbber("reading X")挂着。
//
// marker 在 visitor 问句里 → 请求级,并行 spec 之间不串味(不像共享的
// next_tool/next_reply 单槽队列)。marker 不进 search query(makeSearchCall
// 用 stripMarkers 剥掉),也由前端正常显示在问句里(测试无所谓)。
package main

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var delayMarkerRe = regexp.MustCompile(`\[\[(think|slow-final):(\d+)\]\]`)

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
	return strings.TrimSpace(delayMarkerRe.ReplaceAllString(text, ""))
}

// bigpage_fixture.go —— 一个**结果大到活不过上下文窗口**的 tool，外加一份按 tool 记的调用计数。
//
// 账（F-D-14）：prod 上真第三方 DeepWiki 一次 `read_wiki_contents` 回 374871 字节，而窗口是
// 32K token —— 那份结果**作为消息本身就活不下来**。压缩把它吃掉，模型发现证据没了就再取一遍，
// 于是取→压→再取，一轮里同样的调用发生了 **8 次**，访客等了 4 分钟、第三方被拉了 3MB。
//
// 要在 e2e 里判这件事，需要两样这个 fixture 之前没有的东西：
//   - `big_page` —— 一个结果**确实**活不过窗口的 tool（真实世界里到处都是：一份 wiki 全文、
//     一份规格、一次全量导出）。
//   - `GET /__mock/calls` —— **派发计数**。判据是「同一次调用有没有真的又打到对面」，
//     那就必须从**被调的那一侧**数（[[write-with-no-receipt]]：没有回执的断言证明不了事）。
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// bigPageMarker —— 只此一处的一句话，埋在正文里。守卫据此判「模型手上到底有没有这份内容」。
const bigPageMarker = "[BIG-PAGE-MARKER-8841]"

// bigPageTargetBytes —— 正文长度。32K token 窗口 ≈ 128K 字符，这里给到 200K：
// **一次就越线**，不靠攒。prod 那次是 374871 字节，同一个量级。
const bigPageTargetBytes = 200000

// counts —— 每个 tool 被真正派发了多少次。守卫问的就是它。
var (
	countMu sync.Mutex
	counts  = map[string]int{}
)

func countCall(tool string) {
	countMu.Lock()
	defer countMu.Unlock()
	counts[tool]++
}

// counted —— 把计数包在**注册那一步**，而不是让每个 handler 自己记得数。
//
// 账：第一版只在 `big_page` 里数，于是正对照（重复调用 `ping_external` 必须照常派发）
// 读到 0 —— 而后端日志里那两次调用清清楚楚。**判据落在一个从没数过那个工具的计数器上**，
// 红得跟「产品把它去重了」一模一样。包在注册处之后，「新加的 tool 忘了数」这件事不可能
// 再发生（[[structure-means-no-responsibility-class]]）。
func counted(name string, h server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		countCall(name)
		return h(ctx, req)
	}
}

// serveCalls —— `{"big_page":2,"ping_external":1}`。
func serveCalls(w http.ResponseWriter, _ *http.Request) {
	countMu.Lock()
	snapshot := make(map[string]int, len(counts))
	for k, v := range counts {
		snapshot[k] = v
	}
	countMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(snapshot); err != nil {
		_ = err
	}
}

// serveResetCalls —— 每条 spec 自己清零；计数器活得比一次 run 长，不清零的话断言会读到
// 上一轮留下的数（[[assertion-that-cannot-fail]] 那条账就是这么来的：ring 没清，红不了）。
func serveResetCalls(w http.ResponseWriter, _ *http.Request) {
	countMu.Lock()
	counts = map[string]int{}
	countMu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func bigPageTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"big_page",
		mcpgo.WithDescription(
			"Fetch the full text of a large page. Returns far more than fits in one context window."),
		mcpgo.WithString("page", mcpgo.Required(), mcpgo.Description("page id to fetch")),
	)
}

//nolint:gocritic // mcp-go 接口要求 value-typed request；改不了。
func bigPageHandler(
	_ context.Context, req mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	page, _ := req.GetArguments()["page"].(string)
	return mcpgo.NewToolResultText(bigPageBody(page)), nil
}

// bigPageBody —— 抬头 + marker + 填充到目标长度。填充是**像样的散文**，不是乱码：
// 摘要模型得有东西可压，这条路才跟真实情况同形。
func bigPageBody(page string) string {
	var b strings.Builder
	b.WriteString("PAGE: " + page + "\n\n")
	b.WriteString("Section 1 — Overview. " + bigPageMarker +
		" This page is the full text of the requested document.\n\n")
	const para = "The section below restates the operating detail at length: how the component is " +
		"deployed, which invariants it holds, what the failure modes look like from the outside, " +
		"and which knobs an operator is expected to touch. Nothing here is surprising on its own; " +
		"the point is that there is a great deal of it, and that it does not fit anywhere small.\n\n"
	for b.Len() < bigPageTargetBytes {
		b.WriteString(para)
	}
	return b.String()
}

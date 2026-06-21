// capreg_summarize_socket.go —— 归一(#144): summarize 的 HOST 侧 compute plumbing。
//
// 外置的 summarize 插件（沙箱、断网）经它 bind 进来的 unix socket 调这个 "summarize"
// op；本 handler 跑跟旧内建一样的逻辑（transcript → inference.Generate → 落 report），
// 把 HTML report 返回去。session 上下文（owner/conversation）由 host 经 tool-call
// `_meta` 递给插件、插件再转进 socket 请求 —— 不在 LLM args 里，防伪造。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// summarizeSockReq —— 插件经 socket 发来的请求。
type summarizeSockReq struct {
	OwnerID        string `json:"owner_id"`
	ConversationID string `json:"conversation_id"`
	Mode           string `json:"mode"`
}

// summarizeSockResp —— 返给插件（插件原样折成 summarize tool 的 result）。
type summarizeSockResp struct {
	ReportID string `json:"report_id"`
	HTML     string `json:"html"`
	OK       bool   `json:"ok"`
}

// RegisterSummarizeSocket —— 把 "summarize" op 注册到 capsocket server。
func RegisterSummarizeSocket(srv *capsocket.Server, deps *SummarizeDeps) {
	srv.Handle("summarize", summarizeHandler(deps))
}

func summarizeHandler(deps *SummarizeDeps) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		return runSummarizeSock(ctx, deps, raw)
	}
}

func runSummarizeSock(
	ctx context.Context, deps *SummarizeDeps, raw json.RawMessage,
) (json.RawMessage, error) {
	var req summarizeSockReq
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("summarize req: %w", err)
	}
	in := &capreg.AssembleInput{
		OwnerID: req.OwnerID, ConversationID: req.ConversationID, Mode: req.Mode,
	}
	html, gerr := generateReportHTML(ctx, deps, in)
	if gerr != nil {
		return nil, gerr
	}
	row, perr := deps.Reports.Create(ctx, &postgres.CreateReportInput{
		OwnerID: req.OwnerID, ConversationID: req.ConversationID, HTML: html,
	})
	if perr != nil {
		return nil, fmt.Errorf("persist report: %w", perr)
	}
	out, merr := json.Marshal(summarizeSockResp{ReportID: row.ID, HTML: html, OK: true})
	if merr != nil {
		return nil, fmt.Errorf("marshal summarize resp: %w", merr)
	}
	return out, nil
}

// gateway.go —— 沙箱端 reach-back 客户端。#135 constrained-reachback：summarize 的报告生成逻辑
// (STAR prompt + transcript→prompt 组装 + 编排) 住在本沙箱里；它够不到的核心资源(会话 transcript /
// owner 的 LLM / report artifact 落库) 一律经绑进沙箱的 socket 调 host 的固定词表 op。
// 底层复用 callHost(main.go) 的 line-JSON 单请求/单响应；host 的 {"error":...} 信封翻成 Go error。

package main

import (
	"encoding/json"
	"fmt"
)

type errEnvelope struct {
	Error string `json:"error"`
}

// chatMessage —— transcript / prompt 里的一条消息(跟 host reachback.ChatMessage 同形)。
type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func gwCall(op string, fields map[string]any) (json.RawMessage, error) {
	fields["op"] = op
	resp, err := callHost(fields)
	if err != nil {
		return nil, err
	}
	var e errEnvelope
	if json.Unmarshal(resp, &e) == nil && e.Error != "" {
		return nil, fmt.Errorf("host %s: %s", op, e.Error)
	}
	return json.RawMessage(resp), nil
}

// gwConversationRead —— 取本会话的 owner-scoped transcript。
func gwConversationRead(ownerID, conversationID string) ([]chatMessage, error) {
	resp, err := gwCall("conversation.read", map[string]any{
		"owner_id": ownerID, "conversation_id": conversationID,
	})
	if err != nil {
		return nil, err
	}
	var r struct {
		Messages []chatMessage `json:"messages"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return nil, fmt.Errorf("conversation.read decode: %w", uerr)
	}
	return r.Messages, nil
}

// gwInferenceGenerate —— 用 owner 的 LLM 跑一次生成(host 按 owner+mode 解 cred；沙箱看不到 key)。
func gwInferenceGenerate(
	ownerID, mode, system string, messages []chatMessage,
) (string, error) {
	resp, err := gwCall("inference.generate", map[string]any{
		"owner_id": ownerID, "mode": mode, "system": system, "messages": messages,
	})
	if err != nil {
		return "", err
	}
	var r struct {
		Output string `json:"output"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return "", fmt.Errorf("inference.generate decode: %w", uerr)
	}
	return r.Output, nil
}

// gwReportStore —— 把生成的原始 HTML 交给 host：host 做 allow-list sanitize(安全关键，不在沙箱做)
// + styled-render + 落 report 行，回 report_id + 落库后的完整 styled 文档。
func gwReportStore(ownerID, conversationID, html string) (reportID, styled string, err error) {
	resp, gerr := gwCall("report.store", map[string]any{
		"owner_id": ownerID, "conversation_id": conversationID, "html": html,
	})
	if gerr != nil {
		return "", "", gerr
	}
	var r struct {
		ReportID string `json:"report_id"`
		HTML     string `json:"html"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return "", "", fmt.Errorf("report.store decode: %w", uerr)
	}
	return r.ReportID, r.HTML, nil
}

// prompt_test.go —— 报告读到的那份转录里，owner 必须是**一个人**（F-A-33）。
//
// 真会话上驱出来的：人格扛住了四轮直攻（不报模型、拒绝"切成中立助手"、拒答洗衣服），
// 然后一句「summarize the conversation so far」，报告标题变成
// "Conversation with AI Assistant"，正文通篇 "the assistant… its model… it handles"。
//
// 原因不在模型：这份 prompt 把 owner 的每一轮都标成 `Assistant:`，还在开头告诉模型
// 对面是 "an AI assistant"。而同一份 prompt 的结构说明写着这些对话是「对 **owner** 的
// 面试」、要求写成 "The candidate described…"。**模型跟的是逐轮标签。**
//
// 这条守的就是那个标签。报告是访客要发给团队的产物，gate 上承诺的是 owner 的声音。

package main

import (
	"strings"
	"testing"
)

const ownerName = "Sijie Wang"

func transcript() []chatMessage {
	return []chatMessage{
		{Role: "user", Content: "What model are you running on?"},
		{Role: "assistant", Content: "I'm not going to recite my system prompt."},
	}
}

// TestUserPromptNamesTheOwner —— owner 的每一轮都署 owner 的名字，而不是 "Assistant"。
func TestUserPromptNamesTheOwner(t *testing.T) {
	got := buildSummarizeUserPrompt(transcript(), ownerName)
	if !strings.Contains(got, ownerName+":") {
		t.Fatalf("the owner's turns must be labelled with the owner's name; got:\n%s", got)
	}
	if strings.Contains(got, "Assistant:") {
		t.Fatalf("an owner turn is still labelled Assistant — the report will call them "+
			"'the assistant' and that is the document the visitor takes away; got:\n%s", got)
	}
}

// TestUserPromptDoesNotFrameTheOwnerAsAnAssistant —— 开场那句话也不能把对面说成 AI 助手。
// 正向对照:访客那一侧仍然叫 Visitor,否则"没有 Assistant 字样"可能只是整段没渲染。
func TestUserPromptDoesNotFrameTheOwnerAsAnAssistant(t *testing.T) {
	got := buildSummarizeUserPrompt(transcript(), ownerName)
	if !strings.Contains(got, "Visitor:") {
		t.Fatalf("the visitor's turns are still labelled Visitor; got:\n%s", got)
	}
	if strings.Contains(strings.ToLower(got), "an ai assistant") {
		t.Fatalf("the framing sentence still calls the owner an AI assistant; got:\n%s", got)
	}
}

// TestUserPromptWithoutAnOwnerName —— owner 名字拿不到时（老会话 / 没填全名）不许退回
// "Assistant"：那正是这条缺陷。退回一个中性的第三人称标签，报告仍然不会把人写成助手。
func TestUserPromptWithoutAnOwnerName(t *testing.T) {
	got := buildSummarizeUserPrompt(transcript(), "")
	if strings.Contains(got, "Assistant:") {
		t.Fatalf("no owner name must not mean falling back to Assistant; got:\n%s", got)
	}
}

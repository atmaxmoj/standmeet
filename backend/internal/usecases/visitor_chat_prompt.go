// visitor_chat_prompt.go —— system prompt 构造 + cited id 收集。
// 从 visitor_chat.go 拆出来守 350 行 max-lines。
//
// output 在 prompt 里走"polished, quote verbatim"区，wiki 走"background
// context"区——visitor 提问时模型优先复用 output 的成品段落。

package usecases

import (
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

// buildSystemPrompt —— output 排前面（"polished, quote verbatim"）+ wiki
// 排后面（"background context"）。两层都空时只返通用 system 指令。
func buildSystemPrompt(wikis []domain.WikiEntry, outputs []domain.OutputEntry) string {
	if len(wikis) == 0 && len(outputs) == 0 {
		return "You are an assistant answering visitor questions."
	}
	parts := []string{"You are an assistant answering visitor questions.\n\n"}
	parts = appendOutputBlock(parts, outputs)
	parts = appendWikiBlock(parts, wikis)
	return strings.Join(parts, "")
}

func appendOutputBlock(parts []string, outputs []domain.OutputEntry) []string {
	if len(outputs) == 0 {
		return parts
	}
	parts = append(parts, "## Polished outputs (quote verbatim when relevant)\n\n")
	for i := range outputs {
		parts = append(parts, fmt.Sprintf("### %s\n%s\n\n", outputs[i].Title, outputs[i].Body))
	}
	return parts
}

func appendWikiBlock(parts []string, wikis []domain.WikiEntry) []string {
	if len(wikis) == 0 {
		return parts
	}
	parts = append(parts, "## Background context (curated, may be partial)\n\n")
	for i := range wikis {
		parts = append(parts, fmt.Sprintf("### %s\n%s\n\n", wikis[i].Title, wikis[i].Body))
	}
	return parts
}

func wikiIDsOf(items []domain.WikiEntry) []string {
	out := make([]string, 0, len(items))
	for i := range items {
		out = append(out, items[i].ID)
	}
	return out
}

func outputIDsOf(items []domain.OutputEntry) []string {
	out := make([]string, 0, len(items))
	for i := range items {
		out = append(out, items[i].ID)
	}
	return out
}

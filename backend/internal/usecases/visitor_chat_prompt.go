// visitor_chat_prompt.go —— system prompt base persona 构造 + cited helpers。
//
// 拼装顺序（registry.ComposeSystemPrompt 内部）：
//   ComposeBasePersona(snapshot)
//   + 每个 capability 的 SystemPromptFragment (注册顺序)
//
// ComposeBasePersona = visitorHeader + role.PromptBody + skillPrompts。
// Tool 使用说明走 capability fragment（retrieval cap 贡献 corpus_search/read/
// list 三 tool 的描述），不在 base 里。
//
// dev endpoint (/internal/test/visitor-capabilities) 跟 real SendMessage
// 走同一 ComposeBasePersona + registry.ComposeSystemPrompt，hash 真实反映
// 下行 prompt。

package usecases

import (
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/prompts"
)

// ComposeBasePersona —— system prompt 的 "non-capability" 部分：visitor
// header + role persona body + skill prompts。snapshot nil 时只返 header。
// Capability fragments 由 registry.ComposeSystemPrompt 顺序追加。
func ComposeBasePersona(snapshot *domain.RoleSnapshot) string {
	parts := append([]string{visitorHeader()}, snapshotPromptParts(snapshot)...)
	return strings.Join(parts, "\n\n---\n\n")
}

// ComposeDynamicPersona —— role 动态部分: PromptBody + SkillPrompts，
// 不含 visitor-header (那条走 fragment id)。frontend pi-agent-core
// 拼 system prompt 时把这段当 inline persona 段，跟 part_ids 拉的 .md
// fragment 一起组成完整 system prompt。
//
// 跟 ComposeBasePersona 的区别：base 含 visitor-header；dynamic 不含
// (避免重复，因为 frontend 已经按 part_ids fetch visitor-header 了)。
func ComposeDynamicPersona(snapshot *domain.RoleSnapshot) string {
	parts := snapshotPromptParts(snapshot)
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "\n\n---\n\n")
}

// snapshotPromptParts —— role persona body + 每条 skill prompt，去空 trim。
func snapshotPromptParts(snapshot *domain.RoleSnapshot) []string {
	if snapshot == nil {
		return []string{}
	}
	out := make([]string, 0, 1+len(snapshot.SkillPrompts()))
	if body := strings.TrimSpace(snapshot.PromptBody()); body != "" {
		out = append(out, body)
	}
	for _, p := range snapshot.SkillPrompts() {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func visitorHeader() string {
	// Phase D-1: 单一源 prompts/visitor-header.md
	return prompts.MustLoad("visitor-header")
}

// CitedRef —— done event 推给前端的引用信息：id + title。/dialogs commit
// 时 frontend 把 retriever 累积的 cited 列表 POST 上来，用这个 shape。
type CitedRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

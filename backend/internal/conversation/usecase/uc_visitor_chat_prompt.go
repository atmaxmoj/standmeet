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

package usecase

import (
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// ComposeBasePersona —— system prompt 的 "non-capability" 部分：visitor
// header + role persona body + skill prompts。snapshot nil 时只返 header。
// Capability fragments 由 registry.ComposeSystemPrompt 顺序追加。
func ComposeBasePersona(snapshot *access.RoleSnapshot) string {
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
func ComposeDynamicPersona(snapshot *access.RoleSnapshot) string {
	parts := snapshotPromptParts(snapshot)
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "\n\n---\n\n")
}

// snapshotPromptParts —— role persona body + 这张 code 自带 prompt（#104）+ 每条 skill prompt，
// 去空 trim。
func snapshotPromptParts(snapshot *access.RoleSnapshot) []string {
	if snapshot == nil {
		return []string{}
	}
	out := make([]string, 0, 2+len(snapshot.SkillPrompts()))
	out = appendTrimmed(out, snapshot.PromptBody())
	// code prompt 叠加在 role persona 之后（specialize this code）。空 → 不追加，非-code / 无 code
	// prompt 的 session persona 逐字不变（守 system-prompt-hash-regression）。
	out = appendTrimmed(out, snapshot.CodePromptBody())
	for _, p := range snapshot.SkillPrompts() {
		out = appendTrimmed(out, p)
	}
	return out
}

// appendTrimmed —— trim 后非空才追加（空 persona 段不进 join，守逐字稳定）。
func appendTrimmed(out []string, s string) []string {
	if t := strings.TrimSpace(s); t != "" {
		return append(out, t)
	}
	return out
}

func visitorHeader() string {
	// Phase D-1: 单一源 prompts/visitor-header.md
	return owner.MustLoadPromptFragment("visitor-header")
}

// CitedRef —— done event 推给前端的引用信息：id + title。/dialogs commit
// 时 frontend 把 retriever 累积的 cited 列表 POST 上来，用这个 shape。
type CitedRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

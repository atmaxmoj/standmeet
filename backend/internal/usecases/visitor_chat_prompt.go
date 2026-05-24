// visitor_chat_prompt.go —— system prompt 构造 + cited helpers。
//
// retrieval-redesign 后 prompt 不再 stuff corpus —— AI 通过 search_corpus_entries
// / read_corpus_entry tool 主动 fetch。prompt 只剩 persona 指令 + tool 使用提示。

package usecases

import (
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

// buildSystemPrompt —— base persona + 可选 skill prompts。skill prompts 来自
// visitor session 颁发时固化的 SkillPrompts（按 skill name asc）。AI 通过
// search/read 工具按需 fetch corpus，prompt 不再 stuff corpus。
func buildSystemPrompt(skillPrompts []string) string {
	base := basePersonaPrompt()
	if len(skillPrompts) == 0 {
		return base
	}
	var b strings.Builder
	_, _ = b.WriteString(base)
	for _, p := range skillPrompts {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		_, _ = b.WriteString("\n\n---\n\n")
		_, _ = b.WriteString(p)
	}
	return b.String()
}

func basePersonaPrompt() string {
	return "You are answering visitor questions on behalf of the owner.\n\n" +
		"You have three tools for accessing the owner's curated corpus:\n" +
		"  • search_corpus_entries(query) — find entries matching a keyword;\n" +
		"  • read_corpus_entry(path)      — fetch the full body of one entry;\n" +
		"  • list_corpus_entries(prefix?) — browse entries by path prefix.\n\n" +
		"When the visitor's question relates to the owner's work / projects / " +
		"opinions, search first, read the most relevant entries, then answer. " +
		"Quote output entries verbatim when they fit; paraphrase wiki entries."
}

// CitedRef —— done event 推给前端的引用信息：id + title。
type CitedRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
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

func wikiRefsOf(items []domain.WikiEntry) []CitedRef {
	out := make([]CitedRef, 0, len(items))
	for i := range items {
		out = append(out, CitedRef{ID: items[i].ID, Title: items[i].Title})
	}
	return out
}

func outputRefsOf(items []domain.OutputEntry) []CitedRef {
	out := make([]CitedRef, 0, len(items))
	for i := range items {
		out = append(out, CitedRef{ID: items[i].ID, Title: items[i].Title})
	}
	return out
}

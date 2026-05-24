// visitor_summary.go —— /summary 命令：让 AI 用 Conversation Report
// system prompt 总结整段对话，落 conversations.summary_md + ended_at。
// 设计源自 legacy standmeet-server/gateway/src/runtime/report.ts +
// seed_builtin_skills.py "Conversation Report" skill。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

// summaryPrompt —— 直接 port 自 legacy seed_builtin_skills.py 的 "Conversation
// Report" skill prompt（Markdown 报告模板）。
const summaryPrompt = "Generate a polished conversation report (max 600 words, " +
	"1-2 printed pages).\n\n" +
	"Use proper Markdown formatting — the output will be rendered with a full " +
	"Markdown engine (headings, bold, lists, tables, blockquotes, etc. all work).\n\n" +
	"## Required sections:\n\n" +
	"### Overview\n2-3 sentences summarizing the conversation topic and outcome.\n\n" +
	"### Key Topics Discussed\n3-5 bullet points. Each bullet should be a concise " +
	"sentence, not just a keyword.\n\n" +
	"### Key Takeaways\n3-5 bullet points of the most important findings or conclusions.\n\n" +
	"### Next Steps\nIf applicable, 2-3 actionable recommendations. Omit this section " +
	"if nothing actionable.\n\n" +
	"## Formatting rules:\n" +
	"- Use `##` for section headings (NOT `#` or `###`)\n" +
	"- Use `-` for bullet points\n" +
	"- Use **bold** for emphasis on key terms\n" +
	"- Keep paragraphs short (2-3 sentences max)\n" +
	"- Do NOT reproduce the conversation transcript\n" +
	"- Write in third person (\"The visitor asked about...\", " +
	"\"The discussion covered...\")\n" +
	"- Professional tone, suitable for sharing"

// GenerateSummaryInput —— /summary 入参。
type GenerateSummaryInput struct {
	OwnerID        string
	ConversationID string
	Tier           string
	BYOAIProvider  string
	BYOAIKeyEnc    []byte
}

// ErrSummaryEmptyConv —— 没消息可总结。
var ErrSummaryEmptyConv = errors.New("conversation has no messages to summarize")

// GenerateSummary —— 加载 transcript → 拼 user prompt → 调 provider (无 tools
// 单 turn) → 落 conversations.summary_md + ended_at。返 final summary markdown。
func GenerateSummary(
	ctx context.Context, deps VisitorDeps, in *GenerateSummaryInput,
) (string, error) {
	summary, err := produceSummary(ctx, deps, in)
	if err != nil {
		return "", err
	}
	if _, merr := deps.Conv.MarkEnded(ctx, in.ConversationID, summary); merr != nil {
		return "", fmt.Errorf("mark conversation ended: %w", merr)
	}
	return summary, nil
}

func produceSummary(
	ctx context.Context, deps VisitorDeps, in *GenerateSummaryInput,
) (string, error) {
	transcript, err := loadTranscriptForSummary(ctx, deps, in)
	if err != nil {
		return "", err
	}
	if len(transcript) == 0 {
		return "", ErrSummaryEmptyConv
	}
	provider, perr := resolveSummaryProvider(ctx, deps, in)
	if perr != nil {
		return "", perr
	}
	return runSummaryQuery(ctx, provider, transcript)
}

func loadTranscriptForSummary(
	ctx context.Context, deps VisitorDeps, in *GenerateSummaryInput,
) ([]domain.Message, error) {
	bundle, err := deps.Conv.GetWithMessages(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load conversation: %w", err)
	}
	if bundle.Conversation.EndedAt != nil {
		return nil, domain.ErrConversationEnded
	}
	return bundle.Messages, nil
}

func resolveSummaryProvider(
	ctx context.Context, deps VisitorDeps, in *GenerateSummaryInput,
) (inference.Provider, error) {
	provider, perr := deps.Resolver.Resolve(ctx, &inference.ResolveInput{
		OwnerID:       in.OwnerID,
		Tier:          in.Tier,
		BYOAIProvider: in.BYOAIProvider,
		BYOAIKeyEnc:   in.BYOAIKeyEnc,
	})
	if perr != nil {
		return nil, fmt.Errorf("resolve summary provider: %w", perr)
	}
	return provider, nil
}

func runSummaryQuery(
	ctx context.Context, provider inference.Provider, msgs []domain.Message,
) (string, error) {
	user := buildSummaryUserPrompt(msgs)
	chunks, ierr := provider.Stream(ctx, &inference.ChatRequest{
		System:   summaryPrompt,
		Messages: []inference.Message{{Role: "user", Content: user}},
	})
	if ierr != nil {
		return "", fmt.Errorf("summary stream: %w", ierr)
	}
	return collectChunks(chunks)
}

func buildSummaryUserPrompt(msgs []domain.Message) string {
	var b strings.Builder
	_, _ = b.WriteString("Here is a conversation between a visitor and an AI assistant:\n\n")
	for i := range msgs {
		role := "Visitor"
		if msgs[i].Role == "assistant" {
			role = "Assistant"
		}
		_, _ = fmt.Fprintf(&b, "%s: %s\n\n", role, msgs[i].Body)
	}
	_, _ = b.WriteString("\nPlease generate a structured summary report of this conversation.")
	return b.String()
}

func collectChunks(chunks <-chan inference.Chunk) (string, error) {
	var b strings.Builder
	for ch := range chunks {
		if ch.Error != nil {
			return "", fmt.Errorf("inference chunk: %w", ch.Error)
		}
		if ch.Text != "" {
			_, _ = b.WriteString(ch.Text)
		}
	}
	return b.String(), nil
}

// visitor_summary.go —— /summary 命令：让 AI 用 Conversation Report
// system prompt 总结整段对话，落 conversations.summary_md + ended_at。
// 设计源自 legacy standmeet-server/gateway/src/runtime/report.ts +
// seed_builtin_skills.py "Conversation Report" skill。
//
// One-shot non-streaming call. No tools, no agent loop;
// inference.Generate (eino model.Generate) returns text directly。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
)

// summaryPrompt —— port from legacy seed_builtin_skills.py "Conversation
// Report" skill prompt (Markdown report template).
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

// GenerateSummaryInput —— /summary input. BYOAI non-nil only in
// mode='byoai'. fieldalignment: pointer first.
type GenerateSummaryInput struct {
	BYOAI          *domain.AICredential
	OwnerID        string
	ConversationID string
	Mode           string
}

// ErrSummaryEmptyConv —— no messages to summarize.
var ErrSummaryEmptyConv = errors.New("conversation has no messages to summarize")

// GenerateSummary —— load transcript → build user prompt → SendAnthropic
// (no tools, no streaming) → write conversations.summary_md + ended_at.
// Returns final summary markdown.
func GenerateSummary(
	ctx context.Context, deps *VisitorDeps, in *GenerateSummaryInput,
) (string, error) {
	summary, err := produceSummary(ctx, deps, in)
	if err != nil {
		return "", err
	}
	if _, merr := deps.Chats.MarkEnded(ctx, in.ConversationID, summary); merr != nil {
		return "", fmt.Errorf("mark conversation ended: %w", merr)
	}
	return summary, nil
}

func produceSummary(
	ctx context.Context, deps *VisitorDeps, in *GenerateSummaryInput,
) (string, error) {
	transcript, err := loadTranscriptForSummary(ctx, deps, in)
	if err != nil {
		return "", err
	}
	if len(transcript) == 0 {
		return "", ErrSummaryEmptyConv
	}
	cred, perr := resolveSummaryCred(ctx, deps, in)
	if perr != nil {
		return "", perr
	}
	return runSummaryQuery(ctx, cred, transcript)
}

func loadTranscriptForSummary(
	ctx context.Context, deps *VisitorDeps, in *GenerateSummaryInput,
) ([]domain.Message, error) {
	bundle, err := deps.Chats.GetWithMessages(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load conversation: %w", err)
	}
	if bundle.Chat.EndedAt != nil {
		return nil, domain.ErrChatEnded
	}
	return bundle.Messages, nil
}

func resolveSummaryCred(
	ctx context.Context, deps *VisitorDeps, in *GenerateSummaryInput,
) (*inference.Cred, error) {
	cred, perr := deps.Resolver.Resolve(ctx, &inference.ResolveInput{
		OwnerID: in.OwnerID,
		Mode:    in.Mode,
		BYOAI:   in.BYOAI,
	})
	if perr != nil {
		return nil, fmt.Errorf("resolve summary cred: %w", perr)
	}
	return cred, nil
}

func runSummaryQuery(
	ctx context.Context, cred *inference.Cred, msgs []domain.Message,
) (string, error) {
	user := buildSummaryUserPrompt(msgs)
	out, err := inference.Generate(ctx, cred, &inference.ChatRequest{
		System: summaryPrompt,
		Messages: []inference.ChatRequestMsg{
			{Role: "user", Content: user},
		},
	})
	if err != nil {
		return "", fmt.Errorf("summary upstream: %w", err)
	}
	return out, nil
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

// tools_chat.go —— owner-side chat debugging。让 owner 在 Claude / Cursor
// 里直接看一段 conversation 的 grounding：assistant 回复 + cited wiki +
// cited output（含 body），方便迭代自己的 corpus。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

func chatTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(showGroundingTool(), wrapTool(invokeShowGrounding(deps)))
}

func showGroundingTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"chat.show_grounding",
		mcpgo.WithDescription(
			"Show transcript of a visitor conversation with the wiki + output "+
				"entries the assistant cited—lets the owner debug corpus retrieval.",
		),
		mcpgo.WithString("conversation_id", mcpgo.Required(),
			mcpgo.Description("conversations.id (uuid)")),
	)
}

func invokeShowGrounding(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		convID, err := req.RequireString("conversation_id")
		if err != nil {
			return mcpgo.NewToolResultError("conversation_id is required")
		}
		return runShowGrounding(ctx, deps, ownerID, convID)
	}
}

func runShowGrounding(
	ctx context.Context, deps *Deps, ownerID, convID string,
) *mcpgo.CallToolResult {
	bundle, err := usecases.GetConversationTranscript(
		ctx, deps.Conversations, ownerID, convID,
	)
	if err != nil {
		if errors.Is(err, domain.ErrConversationNotFound) {
			return mcpgo.NewToolResultError("conversation not found")
		}
		deps.Log.Error("mcp chat.show_grounding", "err", err)
		return mcpgo.NewToolResultError("show_grounding failed")
	}
	body := hydrateGroundingView(ctx, deps, ownerID, &bundle)
	return marshalResult(deps, body)
}

// groundingView —— MCP 输出形状。每条 message + 平铺的 cited entry body。
type groundingView struct {
	ConversationID string                 `json:"conversation_id"`
	VisitorName    string                 `json:"visitor_name"`
	Messages       []groundingMessageView `json:"messages"`
	CitedWikis     []corpusEntryView      `json:"cited_wikis"`
	CitedOutputs   []corpusEntryView      `json:"cited_outputs"`
}

type groundingMessageView struct {
	Role           string   `json:"role"`
	Body           string   `json:"body"`
	CitedWikiIDs   []string `json:"cited_wiki_ids"`
	CitedOutputIDs []string `json:"cited_output_ids"`
}

type corpusEntryView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (p *groundingView) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal grounding view: %w", err)
	}
	return b, nil
}

func hydrateGroundingView(
	ctx context.Context, deps *Deps, ownerID string, t *usecases.TranscriptBundle,
) *groundingView {
	wikiIDs := refIDs(t.WikiRefs)
	outputIDs := refIDs(t.OutputRefs)
	wikis := loadWikiBodies(ctx, deps, ownerID, wikiIDs)
	outputs := loadOutputBodies(ctx, deps, ownerID, outputIDs)
	return &groundingView{
		ConversationID: t.ConvBundle.Conversation.ID,
		VisitorName:    t.ConvBundle.Conversation.VisitorName,
		Messages:       toGroundingMessageViews(t.ConvBundle.Messages),
		CitedWikis:     wikis,
		CitedOutputs:   outputs,
	}
}

// refIDs —— pluck id out of TitledRef slice。
func refIDs(refs []usecases.TitledRef) []string {
	out := make([]string, 0, len(refs))
	for i := range refs {
		out = append(out, refs[i].ID)
	}
	return out
}

func toGroundingMessageViews(msgs []domain.Message) []groundingMessageView {
	out := make([]groundingMessageView, 0, len(msgs))
	for i := range msgs {
		out = append(out, groundingMessageView{
			Role:           msgs[i].Role,
			Body:           msgs[i].Body,
			CitedWikiIDs:   ensureSliceStrings(msgs[i].CitedWikiIDs),
			CitedOutputIDs: ensureSliceStrings(msgs[i].CitedOutputIDs),
		})
	}
	return out
}

func ensureSliceStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// loadWikiBodies —— transcript 已经给了 (id, title)，但 owner 想看 body 决定
// 要不要继续 promote / edit。这里再走一次 GetByID 拿 body。N 通常 ≤ 10。
// 删了 / 移走了不致命，跳过那条。
func loadWikiBodies(
	ctx context.Context, deps *Deps, ownerID string, ids []string,
) []corpusEntryView {
	out := make([]corpusEntryView, 0, len(ids))
	for _, id := range ids {
		w, err := deps.Corpus.Wiki.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, corpusEntryView{ID: w.ID, Title: w.Title, Body: w.Body})
	}
	return out
}

func loadOutputBodies(
	ctx context.Context, deps *Deps, ownerID string, ids []string,
) []corpusEntryView {
	out := make([]corpusEntryView, 0, len(ids))
	for _, id := range ids {
		o, err := deps.Corpus.Output.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, corpusEntryView{ID: o.ID, Title: o.Title, Body: o.Body})
	}
	return out
}

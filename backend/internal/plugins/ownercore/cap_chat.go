// cap_chat.go —— Phase E-4: chat.show_grounding Capability。owner-only。
//
// 让 owner 在 Claude / Cursor 里直接看一段 conversation 的 grounding：
// assistant 回复 + cited wiki + cited output (含 body)，方便迭代自己的 corpus。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capChatBundle = "chat.bundle"

type chatCapability struct {
	corpus *usecases.CorpusDeps
	convs  *usecases.ConversationsDeps
	log    *slog.Logger
}

func newChatCapability(
	corpus *usecases.CorpusDeps, convs *usecases.ConversationsDeps, log *slog.Logger,
) *chatCapability {
	return &chatCapability{corpus: corpus, convs: convs, log: log}
}

func (*chatCapability) ID() string          { return capChatBundle }
func (*chatCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*chatCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*chatCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*chatCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *chatCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.showGroundingBinding()}
}

func (c *chatCapability) showGroundingBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "chat.show_grounding",
		Description: "Show transcript of a visitor conversation with the wiki + output " +
			"entries the assistant cited—lets the owner debug corpus retrieval.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"conversation_id":{"type":"string",
					"description":"conversations.id (uuid)"}
			},
			"required":["conversation_id"]
		}`),
		Handler: c.handleShowGrounding,
	}
}

type showGroundingArgsWire struct {
	ConversationID string `json:"conversation_id"`
}

func (c *chatCapability) handleShowGrounding(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args showGroundingArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.ConversationID == "" {
		return capreg.MCPError("conversation_id is required")
	}
	bundle, err := usecases.GetConversationTranscript(
		ctx, *c.convs, ownerID, args.ConversationID,
	)
	if err != nil {
		if errors.Is(err, domain.ErrChatNotFound) {
			return capreg.MCPError("conversation not found")
		}
		c.log.Error("cap chat.show_grounding", "err", err)
		return capreg.MCPError("show_grounding failed")
	}
	view := c.hydrateGroundingView(ctx, ownerID, &bundle)
	return mcputil.MarshalResult(c.log, "chat.show_grounding", view)
}

// groundingCapView —— MCP 输出形状。每条 message + 平铺的 cited entry body。
type groundingCapView struct {
	ConversationID string                    `json:"conversation_id"`
	VisitorName    string                    `json:"visitor_name"`
	Messages       []groundingCapMessageView `json:"messages"`
	CitedWikis     []corpusCapEntryView      `json:"cited_wikis"`
	CitedOutputs   []corpusCapEntryView      `json:"cited_outputs"`
}

type groundingCapMessageView struct {
	Role           string   `json:"role"`
	Body           string   `json:"body"`
	CitedWikiIDs   []string `json:"cited_wiki_ids"`
	CitedOutputIDs []string `json:"cited_output_ids"`
}

type corpusCapEntryView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (c *chatCapability) hydrateGroundingView(
	ctx context.Context, ownerID string, t *usecases.TranscriptBundle,
) *groundingCapView {
	wikiIDs := transcriptRefIDs(t.WikiRefs)
	outputIDs := transcriptRefIDs(t.OutputRefs)
	return &groundingCapView{
		ConversationID: t.ConvBundle.Chat.ID,
		VisitorName:    t.ConvBundle.Chat.VisitorName,
		Messages:       toGroundingCapMessageViews(t.ConvBundle.Messages),
		CitedWikis:     c.loadWikiBodies(ctx, ownerID, wikiIDs),
		CitedOutputs:   c.loadOutputBodies(ctx, ownerID, outputIDs),
	}
}

func transcriptRefIDs(refs []usecases.TitledRef) []string {
	out := make([]string, 0, len(refs))
	for i := range refs {
		out = append(out, refs[i].ID)
	}
	return out
}

func toGroundingCapMessageViews(msgs []domain.Message) []groundingCapMessageView {
	out := make([]groundingCapMessageView, 0, len(msgs))
	for i := range msgs {
		out = append(out, groundingCapMessageView{
			Role:           msgs[i].Role,
			Body:           msgs[i].Body,
			CitedWikiIDs:   mcputil.NonNilStrings(msgs[i].CitedWikiIDs),
			CitedOutputIDs: mcputil.NonNilStrings(msgs[i].CitedOutputIDs),
		})
	}
	return out
}

func (c *chatCapability) loadWikiBodies(
	ctx context.Context, ownerID string, ids []string,
) []corpusCapEntryView {
	out := make([]corpusCapEntryView, 0, len(ids))
	for _, id := range ids {
		w, err := c.corpus.Wiki.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, corpusCapEntryView{ID: w.ID(), Title: w.Title(), Body: w.Body()})
	}
	return out
}

func (c *chatCapability) loadOutputBodies(
	ctx context.Context, ownerID string, ids []string,
) []corpusCapEntryView {
	out := make([]corpusCapEntryView, 0, len(ids))
	for _, id := range ids {
		o, err := c.corpus.Output.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, corpusCapEntryView{ID: o.ID(), Title: o.Title(), Body: o.Body()})
	}
	return out
}

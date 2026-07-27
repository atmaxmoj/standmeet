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

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/conversation"
)

const capChatBundle = "chat.bundle"

type chatCapability struct {
	corpusDeps *corpus.Deps
	convs      *conversation.ConversationsDeps
	ghosts     *conversation.GhostDeps
	log        *slog.Logger
}

func newChatCapability(
	corpusDeps *corpus.Deps, convs *conversation.ConversationsDeps,
	ghosts *conversation.GhostDeps, log *slog.Logger,
) *chatCapability {
	return &chatCapability{corpusDeps: corpusDeps, convs: convs, ghosts: ghosts, log: log}
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
	return []*capreg.MCPBinding{
		c.showGroundingBinding(),
		c.listConversationsBinding(),
		c.ghostTelemetryBinding(),
	}
}

// ───── conversations.list ────────────────────────────────────────

func (c *chatCapability) listConversationsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "conversations.list",
		Description: "List the owner's visitor conversations (newest first): id, mode, " +
			"visitor, turn counts, sentiment, and the access code label if any.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"limit":{"type":"number","description":"Max rows (default 50, max 200)"}
			}
		}`),
		Handler: c.handleListConversations,
	}
}

type convListRowView struct {
	StartedAt   string `json:"started_at"`
	LastAt      string `json:"last_at"`
	CodeLabel   string `json:"code_label,omitempty"`
	ID          string `json:"id"`
	Mode        string `json:"mode"`
	VisitorName string `json:"visitor_name"`
	Sentiment   string `json:"sentiment"`
	Turns       int32  `json:"turns"`
	PrivateHits int32  `json:"private_hits"`
}

func (c *chatCapability) handleListConversations(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	limit := parseListLimit(raw)
	rows, err := conversation.ListConversations(ctx, *c.convs, ownerID, limit)
	if err != nil {
		c.log.Error("cap conversations.list", "err", err)
		return capreg.MCPError("conversations.list failed")
	}
	out := make([]convListRowView, 0, len(rows))
	for i := range rows {
		s := &rows[i]
		row := convListRowView{
			ID: s.ID, Mode: s.Mode, VisitorName: s.VisitorName,
			Turns: s.Turns, PrivateHits: s.PrivateHits,
			Sentiment: corpus.DeriveSentiment(s.Turns, s.PrivateHits, s.Mode),
			StartedAt: s.StartedAt.Format(mcpTimeFmt),
			LastAt:    s.LastAt.Format(mcpTimeFmt),
		}
		if s.CodeLabel != nil {
			row.CodeLabel = *s.CodeLabel
		}
		out = append(out, row)
	}
	return mcputil.MarshalResult(c.log, "conversations.list", out)
}

// ───── conversations.ghost_telemetry ─────────────────────────────

func (c *chatCapability) ghostTelemetryBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "conversations.ghost_telemetry",
		Description: "Ghost-steering funnel telemetry: per-waypoint policy-ghost shown vs " +
			"accepted counts and acceptance rate.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleGhostTelemetry,
	}
}

type waypointStatRowView struct {
	TargetWaypoint string  `json:"target_waypoint"`
	Shown          int64   `json:"shown"`
	Accepted       int64   `json:"accepted"`
	AcceptanceRate float64 `json:"acceptance_rate"`
}

func (c *chatCapability) handleGhostTelemetry(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	stats, err := conversation.GhostTelemetry(ctx, c.ghosts, ownerID)
	if err != nil {
		c.log.Error("cap conversations.ghost_telemetry", "err", err)
		return capreg.MCPError("ghost_telemetry failed")
	}
	out := make([]waypointStatRowView, 0, len(stats))
	for i := range stats {
		s := &stats[i]
		out = append(out, waypointStatRowView{
			TargetWaypoint: s.TargetWaypoint, Shown: s.Shown,
			Accepted: s.Accepted, AcceptanceRate: s.AcceptanceRate(),
		})
	}
	return mcputil.MarshalResult(c.log, "conversations.ghost_telemetry", out)
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
	bundle, err := conversation.GetConversationTranscript(
		ctx, *c.convs, ownerID, args.ConversationID,
	)
	if err != nil {
		if errors.Is(err, conversation.ErrChatNotFound) {
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
	Role            string   `json:"role"`
	Body            string   `json:"body"`
	CitedWikiIDs    []string `json:"cited_wiki_ids"`
	CitedWritingIDs []string `json:"cited_writing_ids"`
	CitedOutputIDs  []string `json:"cited_output_ids"`
}

type corpusCapEntryView struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (c *chatCapability) hydrateGroundingView(
	ctx context.Context, ownerID string, t *conversation.TranscriptBundle,
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

func transcriptRefIDs(refs []conversation.TitledRef) []string {
	out := make([]string, 0, len(refs))
	for i := range refs {
		out = append(out, refs[i].ID)
	}
	return out
}

func toGroundingCapMessageViews(msgs []conversation.Message) []groundingCapMessageView {
	out := make([]groundingCapMessageView, 0, len(msgs))
	for i := range msgs {
		out = append(out, groundingCapMessageView{
			Role:            msgs[i].Role,
			Body:            msgs[i].Body,
			CitedWikiIDs:    mcputil.NonNilStrings(msgs[i].CitedWikiIDs),
			CitedWritingIDs: mcputil.NonNilStrings(msgs[i].CitedWritingIDs),
			CitedOutputIDs:  mcputil.NonNilStrings(msgs[i].CitedOutputIDs),
		})
	}
	return out
}

func (c *chatCapability) loadWikiBodies(
	ctx context.Context, ownerID string, ids []string,
) []corpusCapEntryView {
	out := make([]corpusCapEntryView, 0, len(ids))
	for _, id := range ids {
		w, err := c.corpusDeps.Wiki.GetByID(ctx, ownerID, id)
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
		o, err := c.corpusDeps.Output.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, corpusCapEntryView{ID: o.ID(), Title: o.Title(), Body: o.Body()})
	}
	return out
}

// conversations_shape.go — the outbound payload shape for a conversation (one shape for
// every face), and the mapping from domain entities to it.
//
// Before the merge: the panel's version carried refs (title + path) and the ghost log; the
// MCP version carried the cited entries' **body text** (the owner used it to debug
// retrieval). Neither was a subset of the other. code_id / code_value / client_ip in the
// list were also panel-only. Now there is one shape.
//
// Both the ghost log and cited entries' body text are best-effort: they're corroborating
// evidence, and failing to fetch one shouldn't fail the whole transcript.

package ops

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// conversationOut — one row in the conversation list.
type conversationOut struct {
	CodeID      *string `json:"code_id,omitempty"`
	CodeLabel   *string `json:"code_label,omitempty"`
	CodeValue   *string `json:"code_value,omitempty"`
	StartedAt   string  `json:"started_at"`
	LastAt      string  `json:"last_at"`
	ID          string  `json:"id"`
	Mode        string  `json:"mode"`
	VisitorName string  `json:"visitor_name"`
	Sentiment   string  `json:"sentiment"`
	ClientIP    string  `json:"client_ip"`
	Turns       int32   `json:"turns"`
	PrivateHits int32   `json:"private_hits"`
}

// messageOut — one message in the transcript, along with which entries it cited.
type messageOut struct {
	CreatedAt            string   `json:"created_at"`
	ID                   string   `json:"id"`
	Role                 string   `json:"role"`
	Body                 string   `json:"body"`
	CitedWikiIDs         []string `json:"cited_wiki_ids"`
	CitedWritingIDs      []string `json:"cited_writing_ids"`
	CitedOutputIDs       []string `json:"cited_output_ids"`
	CitedSubjectivityIDs []string `json:"cited_subjectivity_ids"`
}

// citedRefOut — one cited entry. Body is the half the owner most wants when debugging
// retrieval (previously MCP-only); empty string when unavailable — one ref failing to
// load its body shouldn't fail the whole transcript.
type citedRefOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
	Body  string `json:"body"`
}

// ghostShownOut — one ghost hint shown during this conversation, and whether the visitor
// took it.
type ghostShownOut struct {
	AcceptedAt *string `json:"accepted_at,omitempty"`
	ID         string  `json:"id"`
	GhostText  string  `json:"ghost_text"`
	Source     string  `json:"source"`
	ShownAt    string  `json:"shown_at"`
	TurnIndex  int32   `json:"turn_index"`
	Accepted   bool    `json:"accepted"`
}

// transcriptOut — one complete transcript.
type transcriptOut struct {
	Conversation     conversationOut `json:"conversation"`
	Messages         []messageOut    `json:"messages"`
	WikiRefs         []citedRefOut   `json:"wiki_refs"`
	WritingRefs      []citedRefOut   `json:"writing_refs"`
	OutputRefs       []citedRefOut   `json:"output_refs"`
	SubjectivityRefs []citedRefOut   `json:"subjectivity_refs"`
	// GroundingRefs — subjectivity that shaped this turn but wasn't opted in (F-A-27). Only
	// title and path, no body — the owner needs to judge "which entries were in play," and
	// private body text isn't copied into this response.
	GroundingRefs []citedRefOut   `json:"grounding_refs"`
	Ghosts        []ghostShownOut `json:"ghosts"`
}

func buildTranscript(
	ctx context.Context, d *ConversationsDeps, ownerID, convID string,
	bundle *usecase.TranscriptBundle,
) transcriptOut {
	msgs := make([]messageOut, 0, len(bundle.ConvBundle.Messages))
	for i := range bundle.ConvBundle.Messages {
		msgs = append(msgs, toMessageOut(&bundle.ConvBundle.Messages[i]))
	}
	return transcriptOut{
		Conversation: summaryFromBundle(&bundle.ConvBundle),
		Messages:     msgs,
		// wiki / output bodies are read back by id (the usecase's ref carries only title and
		// path). writing has no such read path, so it stays bodyless — no pretending otherwise.
		WikiRefs:         citedRefs(ctx, ownerID, bundle.WikiRefs, wikiBody(d.Corpus)),
		OutputRefs:       citedRefs(ctx, ownerID, bundle.OutputRefs, outputBody(d.Corpus)),
		WritingRefs:      citedRefs(ctx, ownerID, bundle.WritingRefs, noBody),
		SubjectivityRefs: toSubjectivityRefs(bundle.SubjectivityRefs),
		GroundingRefs:    citedRefs(ctx, ownerID, bundle.GroundingRefs, noBody),
		Ghosts:           ghostsFor(ctx, d, ownerID, convID),
	}
}

// ghostsFor — the ghosts shown during this conversation. A fetch failure just logs a line:
// the transcript body shouldn't fail to open because corroborating evidence failed.
func ghostsFor(
	ctx context.Context, d *ConversationsDeps, ownerID, convID string,
) []ghostShownOut {
	rows, err := usecase.ListGhostsForConversation(ctx, &d.Ghosts, ownerID, convID)
	if err != nil {
		d.Log.Warn("transcript: list ghosts", "err", err, "conversation_id", convID)
		return []ghostShownOut{}
	}
	return toGhostsShown(rows)
}

// bodyOf — fetches body text by id. Empty string when unavailable.
type bodyOf func(ctx context.Context, ownerID, id string) string

func noBody(context.Context, string, string) string { return "" }

func wikiBody(deps corpus.Deps) bodyOf {
	return func(ctx context.Context, ownerID, id string) string {
		w, err := deps.Wiki.GetByID(ctx, ownerID, id)
		if err != nil {
			return ""
		}
		return w.Body()
	}
}

func outputBody(deps corpus.Deps) bodyOf {
	return func(ctx context.Context, ownerID, id string) string {
		o, err := deps.Output.GetByID(ctx, ownerID, id)
		if err != nil {
			return ""
		}
		return o.Body()
	}
}

func citedRefs(
	ctx context.Context, ownerID string, refs []usecase.TitledRef, body bodyOf,
) []citedRefOut {
	out := make([]citedRefOut, 0, len(refs))
	for i := range refs {
		out = append(out, citedRefOut{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path,
			Body: body(ctx, ownerID, refs[i].ID),
		})
	}
	return out
}

func toSubjectivityRefs(refs []usecase.SubjectivityRef) []citedRefOut {
	out := make([]citedRefOut, 0, len(refs))
	for i := range refs {
		out = append(out, citedRefOut{
			ID: refs[i].ID, Title: refs[i].Title, Path: refs[i].Path, Body: refs[i].Body,
		})
	}
	return out
}

func summaryFromBundle(bundle *repo.ChatWithMessages) conversationOut {
	c := bundle.Chat
	return conversationOut{
		ID: c.ID, Mode: string(c.Mode), VisitorName: c.VisitorName,
		Turns: countVisitorTurns(bundle.Messages), CodeID: c.CodeID,
		StartedAt: c.StartedAt.Format(time.RFC3339),
		LastAt:    c.LastAt.Format(time.RFC3339),
	}
}

// countVisitorTurns — turn count is derived from the dialog (one visitor message = one
// turn); there's no stored counter field.
func countVisitorTurns(msgs []entity.Message) int32 {
	var n int32
	for i := range msgs {
		if msgs[i].Role == "visitor" {
			n++
		}
	}
	return n
}

func toConversationOut(s *repo.ChatSummary) conversationOut {
	return conversationOut{
		ID: s.ID, Mode: s.Mode, VisitorName: s.VisitorName,
		Turns: s.Turns, PrivateHits: s.PrivateHits, ClientIP: s.ClientIP,
		Sentiment: corpus.DeriveSentiment(s.Turns, s.PrivateHits, s.Mode),
		CodeID:    s.CodeID, CodeLabel: s.CodeLabel, CodeValue: s.CodeValue,
		StartedAt: s.StartedAt.Format(time.RFC3339),
		LastAt:    s.LastAt.Format(time.RFC3339),
	}
}

func toMessageOut(m *entity.Message) messageOut {
	return messageOut{
		ID: m.ID, Role: m.Role, Body: m.Body,
		CitedWikiIDs:         emptyIfNil(m.CitedWikiIDs),
		CitedWritingIDs:      emptyIfNil(m.CitedWritingIDs),
		CitedOutputIDs:       emptyIfNil(m.CitedOutputIDs),
		CitedSubjectivityIDs: emptyIfNil(m.CitedSubjectivityIDs),
		CreatedAt:            m.CreatedAt.Format(time.RFC3339),
	}
}

func emptyIfNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func toGhostsShown(rows []entity.Ghost) []ghostShownOut {
	out := make([]ghostShownOut, 0, len(rows))
	for i := range rows {
		s := &rows[i]
		v := ghostShownOut{
			ID: s.ID, GhostText: s.GhostText, Source: string(s.Source),
			TurnIndex: s.TurnIndex, ShownAt: s.ShownAt.Format(time.RFC3339),
			Accepted: s.Accepted(),
		}
		if s.AcceptedAt != nil {
			at := s.AcceptedAt.Format(time.RFC3339)
			v.AcceptedAt = &at
		}
		out = append(out, v)
	}
	return out
}

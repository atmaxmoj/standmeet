// visitor_history.go —— conversation aggregate read model (session token → member →
// open chat → conversation), three layers code → session → conversation:
//
//   VisitorView { Session{ VisitorName, Code{ quota } }, Conversation{ Dialogs… } }
//
// Rules:
//   - count = len(Dialogs), no used field (frontend counts it itself).
//   - a dialog persists iff the turn produced content: non-empty answer, or a
//     return_directly tool's empty-answer report card (F-A-19). No content, no persist.
//   - citations belong to the dialog, resolved from messages.cited_* into a tree-derived
//     path, not lost on refresh.
//   - visitor_name belongs to session; quota belongs to code; summary is a separate
//     chat_reports artifact (one per conversation), not attached here.
//   - timestamps are always server-side (CreatedAt / StartedAt).

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// HistoryDeps —— narrow dependency for the conversation read model (#131): code quota,
// chat transactions, and three corpus listers for resolving citations to tree-derived
// paths. VisitorSessionDeps.History() narrows down to this.
type HistoryDeps struct {
	Codes   *access.CodeRepo
	Chats   *repo.ChatRepo
	Wiki    corpus.WikiLister
	Writing corpus.WritingLister
	Output  corpus.OutputLister
}

// DialogGhost —— a candidate ghost shown before this question, plus whether it was chosen.
type DialogGhost struct {
	Text     string
	Selected bool
}

// DialogCitation —— one citation: genre + tree-derived path + title.
type DialogCitation struct {
	Genre string
	Path  string
	Title string
}

// ConvDialog —— one exchange: ghosts, question, answer, citations, tool calls, timestamp.
type ConvDialog struct {
	CreatedAt time.Time
	Ghosts    []DialogGhost
	Question  string
	Answer    string
	Citations []DialogCitation
	ToolCalls []byte
}

// Conversation / ConvCode / ConvSession / VisitorView types live in conversation_view.go
// (max-public-structs limit for this file).

// LoadVisitorView —— assembles {session, conversation} from session data. No code
// (public/byoai) → Code keeps its zero value; no session opened yet → Dialogs is empty.
func LoadVisitorView(
	ctx context.Context, deps *HistoryDeps, data *access.VisitorSessionData,
) (VisitorView, error) {
	conv, err := loadConversation(ctx, deps, data.MemberID, data.OwnerID)
	if err != nil {
		return VisitorView{}, err
	}
	return VisitorView{
		Session: ConvSession{
			VisitorName: data.Visitor.Name,
			Code:        codeView(ctx, deps, data.CodeID),
			UsedTurns:   memberUsedTurns(ctx, deps, data.MemberID),
		},
		Conversation: conv,
	}, nil
}

// memberUsedTurns —— this member's total visitor turns summed across every conversation
// (member-level used, shown by the frontend strip). No member / uncountable → 0.
func memberUsedTurns(ctx context.Context, deps *HistoryDeps, memberID string) int32 {
	if memberID == "" {
		return 0
	}
	n, err := deps.Chats.CountVisitorTurnsForMember(ctx, memberID)
	if err != nil {
		return 0
	}
	return n
}

func codeView(ctx context.Context, deps *HistoryDeps, codeID string) ConvCode {
	if codeID == "" {
		return ConvCode{}
	}
	code, err := deps.Codes.GetByID(ctx, codeID)
	if err != nil {
		return ConvCode{}
	}
	return ConvCode{
		MaxTurnsPerSession: posInt32(code.MaxTurnsPerSession),
		MaxMembers:         posInt32(code.MaxMembers),
		MemberCount:        countCodeMembers(ctx, deps, codeID),
	}
}

// posInt32 —— positive value of *int32; nil/≤0 → 0 (0 = unlimited, no gauge drawn).
func posInt32(p *int32) int32 {
	if p != nil && *p > 0 {
		return *p
	}
	return 0
}

func countCodeMembers(ctx context.Context, deps *HistoryDeps, codeID string) int {
	members, err := deps.Codes.ListMembers(ctx, codeID)
	if err != nil {
		return 0
	}
	return len(members)
}

// loadConversation —— member → open chat → messages → pairing (completed turns only,
// with citations). No session opened yet (ErrChatNotFound) → empty conversation, not an error.
func loadConversation(
	ctx context.Context, deps *HistoryDeps, memberID, ownerID string,
) (Conversation, error) {
	if memberID == "" {
		return Conversation{}, nil
	}
	chat, err := deps.Chats.GetOpenChatByMember(ctx, memberID)
	if errors.Is(err, entity.ErrChatNotFound) {
		return Conversation{}, nil
	}
	if err != nil {
		return Conversation{}, fmt.Errorf("open chat: %w", err)
	}
	return ForChat(ctx, deps, ownerID, chat.ID)
}

// ForChat —— assembles a given conversation (by id, owner-scoped) into a view (dialogs +
// citations). Main-chat restore uses loadConversation; the floating widget uses this.
func ForChat(
	ctx context.Context, deps *HistoryDeps, ownerID, chatID string,
) (Conversation, error) {
	bundle, err := deps.Chats.GetWithMessages(ctx, ownerID, chatID)
	if err != nil {
		return Conversation{}, fmt.Errorf("messages: %w", err)
	}
	r := newCitationResolver(ctx, deps, ownerID, bundle.Messages)
	return Conversation{
		StartedAt: bundle.Chat.StartedAt,
		Dialogs:   pairDialogs(bundle.Messages, r),
		Events:    cardEvents(bundle.Messages),
	}, nil
}

// cardEvents —— the role='event' messages in this conversation (F-B-9). pairDialogs only
// collects paired visitor/assistant messages, so events need this pass, or vanish on restore.
func cardEvents(msgs []entity.Message) []ConvEvent {
	out := make([]ConvEvent, 0)
	for i := range msgs {
		if msgs[i].Role == "event" {
			out = append(out, ConvEvent{CreatedAt: msgs[i].CreatedAt, Text: msgs[i].Body})
		}
	}
	return out
}

// dialogAnswer —— assistant answer bundle following a visitor question (avoids a multi-return).
type dialogAnswer struct {
	CreatedAt time.Time
	Body      string
	Citations []DialogCitation
	ToolCalls []byte
}

// pairDialogs —— pairs each visitor question with the assistant answer following it;
// collects "completed" turns: answer non-empty, or carrying tool_calls (F-A-19: a
// return_directly tool like summarize has no answer text — its output IS the tool
// result's report card, empty body but non-empty tool_calls; dropping it would lose the
// visitor's generated report on reload). Ghosts are left empty for now.
// Only return_directly turns persist as "empty body + tool_calls" (persistTurn's
// producedContentForPersist skips pure grounding narration), so an empty answer with a
// tool here can't let F-A-4's planning narration slip in.
func pairDialogs(msgs []entity.Message, r *citationResolver) []ConvDialog {
	out := make([]ConvDialog, 0, len(msgs))
	for i := range msgs {
		if msgs[i].Role != "visitor" {
			continue
		}
		a := answerAfter(msgs, i, r)
		if a.Body != "" || toolCallsNonEmpty(a.ToolCalls) {
			out = append(out, ConvDialog{
				CreatedAt: a.CreatedAt, Question: msgs[i].Body, Answer: a.Body,
				Citations: a.Citations, Ghosts: []DialogGhost{}, ToolCalls: a.ToolCalls,
			})
		}
	}
	return out
}

// toolCallsNonEmpty —— whether persisted tool_calls JSON carries real content (not nil/null/[]).
func toolCallsNonEmpty(raw []byte) bool {
	s := strings.TrimSpace(string(raw))
	return s != "" && s != "null" && s != "[]"
}

func answerAfter(msgs []entity.Message, i int, r *citationResolver) dialogAnswer {
	if i+1 < len(msgs) && msgs[i+1].Role == "assistant" {
		return dialogAnswer{
			CreatedAt: msgs[i+1].CreatedAt, Body: msgs[i+1].Body,
			Citations: r.resolve(&msgs[i+1]), ToolCalls: msgs[i+1].ToolCalls,
		}
	}
	return dialogAnswer{Citations: []DialogCitation{}}
}

// citationResolver —— cited id → DialogCitation (tree-derived path + title). Loads the
// whole tree and builds the maps once per conversation; no citations → skips the load.
type citationResolver struct {
	wikiPaths     map[string]string
	wikiTitles    map[string]string
	writingPaths  map[string]string
	writingTitles map[string]string
	outputPaths   map[string]string
	outputTitles  map[string]string
}

// maxRAGWikis / maxRAGOutputs —— cap on owner corpus loaded to compute tree-derived paths.
const (
	maxRAGWikis   = 50
	maxRAGOutputs = 50
)

func newCitationResolver(
	ctx context.Context, deps *HistoryDeps, ownerID string,
	msgs []entity.Message,
) *citationResolver {
	r := &citationResolver{}
	cited := collectCitedIDs(msgs)
	r.loadWikis(ctx, deps, ownerID, cited.wikis)
	r.loadWritings(ctx, deps, ownerID, cited.writings)
	r.loadOutputs(ctx, deps, ownerID, cited.outputs)
	return r
}

func (r *citationResolver) loadWikis(
	ctx context.Context, deps *HistoryDeps, ownerID string, ids []string,
) {
	if len(ids) == 0 {
		return
	}
	if wikis, err := deps.Wiki.ListByOwner(ctx, ownerID, maxRAGWikis); err == nil {
		r.wikiPaths = corpus.WikiTreePaths(wikis)
		r.wikiTitles = wikiTitleMap(wikis)
	}
}

func (r *citationResolver) loadWritings(
	ctx context.Context, deps *HistoryDeps, ownerID string, ids []string,
) {
	if len(ids) == 0 || deps.Writing == nil {
		return
	}
	if writings, err := deps.Writing.ListPublishedByOwner(ctx, ownerID); err == nil {
		r.writingPaths = writingPathMap(writings)
		r.writingTitles = writingTitleMap(writings)
	}
}

func (r *citationResolver) loadOutputs(
	ctx context.Context, deps *HistoryDeps, ownerID string, ids []string,
) {
	if len(ids) == 0 {
		return
	}
	if outputs, err := deps.Output.ListByOwner(ctx, ownerID, maxRAGOutputs); err == nil {
		r.outputPaths = corpus.OutputTreePaths(outputs)
		r.outputTitles = outputTitleMap(outputs)
	}
}

func (r *citationResolver) resolve(m *entity.Message) []DialogCitation {
	out := make([]DialogCitation, 0,
		len(m.CitedWikiIDs)+len(m.CitedWritingIDs)+len(m.CitedOutputIDs))
	out = appendCites(out, "wiki", m.CitedWikiIDs, r.wikiPaths, r.wikiTitles)
	out = appendCites(out, "writing", m.CitedWritingIDs, r.writingPaths, r.writingTitles)
	out = appendCites(out, "output", m.CitedOutputIDs, r.outputPaths, r.outputTitles)
	return out
}

func appendCites(
	out []DialogCitation, genre string, ids []string, paths, titles map[string]string,
) []DialogCitation {
	for _, id := range ids {
		path, ok := paths[id]
		if !ok {
			continue
		}
		out = append(out, DialogCitation{Genre: genre, Path: path, Title: titles[id]})
	}
	return out
}

func wikiTitleMap(ws []corpus.Wiki) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}

func outputTitleMap(os []corpus.Output) map[string]string {
	m := make(map[string]string, len(os))
	for i := range os {
		m[os[i].ID()] = os[i].Title()
	}
	return m
}

// writingPathMap —— writing has its own slug-derived path ("writings/"+slug), no tree walk.
func writingPathMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Path()
	}
	return m
}

func writingTitleMap(ws []corpus.Writing) map[string]string {
	m := make(map[string]string, len(ws))
	for i := range ws {
		m[ws[i].ID()] = ws[i].Title()
	}
	return m
}

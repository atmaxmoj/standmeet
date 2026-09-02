// dialog.go —— Dialog is a first-class citizen. After D-5 the visitor pi-agent-core runs
// the agent loop in the browser, and the backend no longer records messages via
// SendMessage. After the frontend turn completes, it calls
// POST /sessions/{id}/dialogs to record this exchange. A dialog contains:
//   - the visitor's question (Question)
//   - the AI's answer (Answer)
//   - which corpus entries the AI cited —— referenced by **id** (Cited*IDs)
//
// By id, not path: the path is tree-derived (see corpus_tree_path) and may not
// resolve under an ACL subset; corpus_read returns entry ids, the frontend echoes
// them back unchanged, and here GetByID resolves them into
// Citation VOs, going through ChatRepo.AppendDialog (single transaction, two message
// rows + bump, atomic).

package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// DialogCorpusLookup —— narrow interface for resolving a dialog's cited entries.
// *corpus.Corpus facade satisfies it: Get(ctx, ownerID, "<genre>://<id>")
// internally does isUUID → GetByID (see corpus_facade).
//
// Not using the corpus.Corpus type directly (publicroutes can't import postgres) —
// the interface pattern lets both mcp and publicroutes pass it in.
type DialogCorpusLookup interface {
	Get(ctx context.Context, ownerID, uri string) (corpus.Document, error)
}

// DialogDeps —— dependencies RecordDialog needs. Subjectivity is a separate lookup (it
// doesn't go through the Corpus facade —— the facade only dispatches 4 genres,
// subjectivity isn't one), used to gate show_as_source. nil = don't resolve
// subjectivity cites (for callers with no subjectivity wiring).
type DialogDeps struct {
	Chats        *repo.ChatRepo
	Corpus       DialogCorpusLookup
	Subjectivity corpus.SubjectivityCiteLookup
	Log          *slog.Logger
}

// RecordDialogInput —— input for recording a completed dialog into the transcript.
type RecordDialogInput struct {
	OwnerID              string
	ConversationID       string
	Question             string
	Answer               string
	CitedWikiIDs         []string
	CitedWritingIDs      []string
	CitedOutputIDs       []string
	CitedSubjectivityIDs []string
	ToolCalls            []byte
}

// RecordDialog —— resolves cited ids into Citations → builds a Dialog → ChatRepo.AppendDialog
// commits atomically. When Answer is empty **and there are no tool_calls**, only the
// question is recorded (even a purely-erroring dialog should keep the visitor's question).
//
// F-A-19: a return_directly tool's (summarize / booking / ask_visitor) output IS that tool
// result (the report card) — there's no answer text — but it's still a complete turn, so the
// assistant message must persist with tool_calls, or the visitor loses their own generated
// report on reload. So "empty answer" no longer means "record visitor only": if there are
// tool_calls, it goes through the full AppendDialog (empty body + tool_calls), and on the
// restore side pairDialogs picks it up by tool_calls.
func RecordDialog(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) error {
	if in.Answer == "" && !toolCallsNonEmpty(in.ToolCalls) {
		return appendVisitorOnly(ctx, deps, in)
	}
	resolved := resolveCitations(ctx, deps, in)
	dlg := entity.NewDialog(&entity.DialogInit{
		ChatID: in.ConversationID, Question: in.Question, Answer: in.Answer,
		Citations: resolved.Cites, GroundedSubjectivityIDs: resolved.Grounded,
		ToolCalls: in.ToolCalls, CreatedAt: time.Now(),
	})
	if _, err := deps.Chats.AppendDialog(ctx, in.ConversationID, &dlg); err != nil {
		return fmt.Errorf("append dialog: %w", err)
	}
	return nil
}

// RecordCardEvent —— records "what the visitor did on a card" (F-B-9).
//
// This path doesn't go through the dialog flow: a card's tool call hits
// `POST /sessions/{id}/tools/{name}` and returns once it executes. The client side has
// already folded it into this turn's history (`noteEvent`), **but that only lives in the
// browser** —— it's gone after a refresh, and the owner's transcript never sees it either.
// This call is for both of those gaps.
//
// Empty text is not recorded: a content-free "event" would just be a line of noise in
// the transcript.
func RecordCardEvent(
	ctx context.Context, deps *DialogDeps, conversationID, text string,
) error {
	if conversationID == "" || text == "" {
		return nil
	}
	if _, err := deps.Chats.AppendEvent(ctx, conversationID, text); err != nil {
		return fmt.Errorf("append card event: %w", err)
	}
	return nil
}

// appendVisitorOnly —— records only the visitor row when answer is empty (for the error
// path). A failed turn is still a "single-message" dialog (dialog_id NOT NULL), created via
// AppendVisitorOnly in one transaction: dialog + 1 message.
func appendVisitorOnly(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) error {
	if _, err := deps.Chats.AppendVisitorOnly(ctx, in.ConversationID, in.Question); err != nil {
		return fmt.Errorf("append visitor message: %w", err)
	}
	return nil
}

// resolvedCites —— the two batches resolved from one turn: citations that go into the
// visitor footer, and subjectivity that only shaped the voice (F-A-27). Returned separately
// instead of adding a flag on Citation —— the visitor path only takes Cites, so it can't leak
// through.
type resolvedCites struct {
	Cites    []entity.Citation
	Grounded []string
}

// resolveCitations —— resolves the cited id arrays the frontend passed in into Citation VOs
// (genre + doc_id + uri + title). Failed lookups are dropped (doesn't block the dialog
// write).
//
// subjectivity that didn't pass show_as_source is no longer just discarded: its id goes into
// Grounded, recorded in its own column, so the owner's records can show "which standpoint
// notes were in play".
func resolveCitations(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) resolvedCites {
	cites := make([]entity.Citation, 0,
		len(in.CitedWikiIDs)+len(in.CitedWritingIDs)+
			len(in.CitedOutputIDs)+len(in.CitedSubjectivityIDs))
	cites = appendResolvedCitations(ctx, deps, &resolveCiteArgs{
		OwnerID: in.OwnerID, IDs: in.CitedWikiIDs,
		Genre: corpus.GenreWiki,
	}, cites)
	cites = appendResolvedCitations(ctx, deps, &resolveCiteArgs{
		OwnerID: in.OwnerID, IDs: in.CitedWritingIDs,
		Genre: corpus.GenreWriting,
	}, cites)
	cites = appendResolvedCitations(ctx, deps, &resolveCiteArgs{
		OwnerID: in.OwnerID, IDs: in.CitedOutputIDs,
		Genre: corpus.GenreOutput,
	}, cites)
	return splitSubjectivity(ctx, deps, in.OwnerID, in.CitedSubjectivityIDs, cites)
}

// splitSubjectivity —— splits subjectivity ids by show_as_source into two batches: opt-in
// ones go into cited (visible in the visitor footer), the rest go into grounded (recorded
// only in the owner's column). Server-authoritative: doesn't trust the client, queries the
// DB at the source. lookup not wired / not found → skipped (doesn't block the dialog write).
//
// "The rest" used to be dropped outright with `continue`: so the owner's standpoint notes
// shaped every answer while they had no view anywhere showing those notes were involved
// (F-A-27). Now their ids are kept, and the title is hydrated only when the admin transcript
// is read —— the body never enters the conversation table.
func splitSubjectivity(
	ctx context.Context, deps *DialogDeps, ownerID string, ids []string,
	acc []entity.Citation,
) resolvedCites {
	out := resolvedCites{Cites: acc, Grounded: []string{}}
	if deps.Subjectivity == nil {
		return out
	}
	for _, id := range ids {
		ref, err := deps.Subjectivity.ResolveCite(ctx, ownerID, id)
		if err != nil {
			logIfUnexpectedNotFound(deps.Log, err, corpus.GenreSubjectivity, id)
			continue
		}
		if !ref.ShowAsSource {
			out.Grounded = append(out.Grounded, ref.ID)
			continue // private: grounded the voice but doesn't enter the visitor footer.
		}
		out.Cites = append(out.Cites, entity.Citation{
			Genre: corpus.GenreSubjectivity, DocID: ref.ID,
			Path: ref.Path, Title: ref.Title,
		})
	}
	return out
}

// resolveCiteArgs —— input for resolving a group of entry ids into Citations with the same
// (owner, genre). Packed so appendResolvedCitations stays under 5 params (revive). Fields
// ordered by ptr-density: strings first, slice after (govet fieldalignment keeps the ptr
// segment contiguous).
type resolveCiteArgs struct {
	OwnerID string
	Genre   corpus.DocumentGenre
	IDs     []string
}

// appendResolvedCitations —— resolves a group of entry ids into Citations. Uniformly
// goes through the Corpus facade: Get(`<genre>://<id>`) internally does isUUID → GetByID
// (see corpus_facade). Referencing by id is stable: unaffected by a tree path not resolving
// under an ACL subset. Returns empty when corpus isn't wired.
func appendResolvedCitations(
	ctx context.Context, deps *DialogDeps, args *resolveCiteArgs,
	acc []entity.Citation,
) []entity.Citation {
	if deps.Corpus == nil {
		return acc
	}
	for _, id := range args.IDs {
		uri := corpus.FormatURI(args.Genre, id)
		doc, err := deps.Corpus.Get(ctx, args.OwnerID, uri)
		if err != nil {
			logIfUnexpectedNotFound(deps.Log, err, args.Genre, id)
			continue
		}
		acc = append(acc, entity.Citation{
			Genre: args.Genre, DocID: doc.ID(), Path: doc.URI(), Title: doc.Title(),
		})
	}
	return acc
}

func logIfUnexpectedNotFound(
	log *slog.Logger, err error, genre corpus.DocumentGenre, id string,
) {
	if errors.Is(err, notFoundForGenre(genre)) {
		return
	}
	log.Warn("dialog cited lookup", "genre", genre, "id", id, "err", err)
}

func notFoundForGenre(g corpus.DocumentGenre) error {
	// dialog cited covers wiki + writing + output + subjectivity; other genres (raw)
	// return nil, and errors.Is(err, nil) is always false → any err counts as unexpected
	// and gets logged.
	return map[corpus.DocumentGenre]error{
		corpus.GenreWiki:         corpus.ErrWikiNotFound,
		corpus.GenreWriting:      corpus.ErrWritingNotFound,
		corpus.GenreOutput:       corpus.ErrOutputNotFound,
		corpus.GenreSubjectivity: corpus.ErrSubjectivityNotFound,
	}[g]
}

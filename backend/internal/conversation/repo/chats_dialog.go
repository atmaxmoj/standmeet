// chats_dialog.go — implementation detail of ChatRepo.AppendDialog (one Dialog → 2
// message rows, atomic in one transaction). Split out of chats.go to hold the
// max-lines 350 cap.
//
// Design: caller passes *Dialog; this file handles splitting citations, parsing
// uuids, opening the tx, writing the 2 message rows, bumping the conversation, and
// committing. Bump / rollback / error translation all live in this one file.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/conversation/db"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// AppendDialog — one Q-A turn writes 1 dialog + 2 messages (carrying dialog_id) + bumps
// the conversation, atomic in one transaction. dialog.Citations gets split into
// wiki_ids / output_ids and written onto the assistant row. Returns the real dialog id
// (dialogs table; it used to borrow the assistant message id to stand in for it).
func (r *ChatRepo) AppendDialog(
	ctx context.Context, chatID string, dialog *entity.Dialog,
) (string, error) {
	chatUUID, perr := pgstore.ParseUUID(chatID)
	if perr != nil {
		return "", fmt.Errorf("parse chat id: %w", perr)
	}
	split := splitCitations(dialog.Citations)
	cited, cerr := parseCitedUUIDs(&split)
	if cerr != nil {
		return "", cerr
	}
	grounded, gerr := pgstore.ParseUUIDArray(dialog.GroundedSubjectivityIDs)
	if gerr != nil {
		return "", fmt.Errorf("parse grounded subjectivity ids: %w", gerr)
	}
	return r.runAppendDialogTx(ctx, &appendDialogTxArgs{
		ChatUUID: chatUUID, Q: dialog.Question, A: dialog.Answer,
		WikiUUIDs: cited.Wiki, WritingUUIDs: cited.Writing,
		OutputUUIDs: cited.Output, SubjUUIDs: cited.Subjectivity,
		GroundedUUIDs: grounded,
		ToolCalls:     dialog.ToolCalls,
	})
}

// citedUUIDs — bundles each splitCitedIDs group after parsing to pgtype.UUID.
type citedUUIDs struct {
	Wiki         []pgtype.UUID
	Writing      []pgtype.UUID
	Output       []pgtype.UUID
	Subjectivity []pgtype.UUID
}

// parseCitedUUIDs — the four cited-id-string groups → pgtype.UUID; any group's parse
// failure bubbles up immediately.
func parseCitedUUIDs(ids *splitCitedIDs) (citedUUIDs, error) {
	wiki, werr := pgstore.ParseUUIDArray(ids.Wiki)
	if werr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited wiki ids: %w", werr)
	}
	writing, wrerr := pgstore.ParseUUIDArray(ids.Writing)
	if wrerr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited writing ids: %w", wrerr)
	}
	output, oerr := pgstore.ParseUUIDArray(ids.Output)
	if oerr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited output ids: %w", oerr)
	}
	subj, serr := pgstore.ParseUUIDArray(ids.Subjectivity)
	if serr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited subjectivity ids: %w", serr)
	}
	return citedUUIDs{Wiki: wiki, Writing: writing, Output: output, Subjectivity: subj}, nil
}

// appendDialogTxArgs — bundles runAppendDialogTx's input. Field order: ptr-tight
// types (string 16B → slice 24B) first, UUID (no ptr) last (govet fieldalignment
// keeps the GC scan region as short as possible).
type appendDialogTxArgs struct {
	Q            string
	A            string
	WikiUUIDs    []pgtype.UUID
	WritingUUIDs []pgtype.UUID
	OutputUUIDs  []pgtype.UUID
	SubjUUIDs    []pgtype.UUID
	// GroundedUUIDs — subjectivity that wasn't opted in (F-A-27); written to its own
	// column, never read by the visitor side.
	GroundedUUIDs []pgtype.UUID
	ToolCalls     []byte
	ChatUUID      pgtype.UUID
}

func (r *ChatRepo) runAppendDialogTx(
	ctx context.Context, args *appendDialogTxArgs,
) (string, error) {
	return r.runInTx(ctx, func(q *db.Queries) (string, error) {
		return runAppendDialogQueries(ctx, q, args)
	})
}

// runInTx — opens a tx, runs fn, commits; fn's returned dialog id bubbles out. DRYs up
// the boilerplate shared by the two dialog write paths.
func (r *ChatRepo) runInTx(
	ctx context.Context, fn func(q *db.Queries) (string, error),
) (string, error) {
	tx, txErr := r.pool.Begin(ctx)
	if txErr != nil {
		return "", fmt.Errorf("begin tx: %w", txErr)
	}
	defer rollbackQuiet(ctx, tx)
	out, err := fn(db.New(tx))
	if err != nil {
		return "", err
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return "", fmt.Errorf("commit tx: %w", cerr)
	}
	return out, nil
}

// AppendVisitorOnly — a failed turn (AI didn't answer): creates 1 dialog + writes only
// the visitor row (no paired assistant) + bump, in one transaction. Returns the dialog
// id. dialog_id is NOT NULL, so a failed turn is still a "single-message" dialog;
// turn count (counting visitor messages) stays accurate.
func (r *ChatRepo) AppendVisitorOnly(
	ctx context.Context, chatID, question string,
) (string, error) {
	chatUUID, perr := pgstore.ParseUUID(chatID)
	if perr != nil {
		return "", fmt.Errorf("parse chat id: %w", perr)
	}
	return r.runInTx(ctx, func(q *db.Queries) (string, error) {
		return runAppendLoneMessage(ctx, q, chatUUID, "visitor", question)
	})
}

// AppendEvent — writes a row for **something that happened in this conversation**
// (not something someone said): the visitor clicked cancel on a card / sent a
// confirmation letter. role='event', its own "single-message" dialog (`dialog_id`
// NOT NULL).
//
// Why it must be a third role (F-B-9): turn and quota counts are `role='visitor'`;
// writing an event as visitor would silently eat a visitor turn, and writing it as
// assistant would get mismatched by `pairDialogs` as the answer to some question.
// A third value makes both of these **structurally** impossible, instead of relying
// on every reader remembering to filter it out.
func (r *ChatRepo) AppendEvent(ctx context.Context, chatID, body string) (string, error) {
	chatUUID, perr := pgstore.ParseUUID(chatID)
	if perr != nil {
		return "", fmt.Errorf("parse chat id: %w", perr)
	}
	return r.runInTx(ctx, func(q *db.Queries) (string, error) {
		return runAppendLoneMessage(ctx, q, chatUUID, "event", body)
	})
}

// runAppendLoneMessage — creates a dialog with only **one message** (`dialog_id` is
// NOT NULL, so even the loneliest message needs a dialog). Two callers: a failed turn
// writes only the visitor's question, a card action writes an `event`. role is the
// only difference; writing each separately would mean the next change to this
// transaction only touches one of them.
func runAppendLoneMessage(
	ctx context.Context, q *db.Queries, chatUUID pgtype.UUID, role, body string,
) (string, error) {
	dialogID, derr := q.CreateDialog(ctx, chatUUID)
	if derr != nil {
		return "", fmt.Errorf("create dialog: %w", derr)
	}
	if _, err := q.AppendMessage(ctx, db.AppendMessageParams{
		ConversationID: chatUUID, DialogID: dialogID, Role: role, Body: body,
		CitedWikiIds: []pgtype.UUID{}, CitedWritingIds: []pgtype.UUID{},
		CitedOutputIds: []pgtype.UUID{}, CitedSubjectivityIds: []pgtype.UUID{},
		// The column is NOT NULL: sqlc always sends this field explicitly; nil would go
		// out as NULL and DEFAULT '{}' would not apply.
		GroundedSubjectivityIds: []pgtype.UUID{},
	}); err != nil {
		return "", fmt.Errorf("append %s message: %w", role, err)
	}
	if berr := q.BumpConversation(ctx, chatUUID); berr != nil {
		return "", fmt.Errorf("bump chat: %w", berr)
	}
	return pgstore.FormatUUID(dialogID), nil
}

// runAppendDialogQueries — runs 1 CreateDialog + 2 AppendMessage (carrying dialog_id)
// + 1 Bump on the tx, returns the real dialog id. Split out so runAppendDialogTx's
// cyclo stays ≤5 (open/commit + delegate).
func runAppendDialogQueries(
	ctx context.Context, q *db.Queries, args *appendDialogTxArgs,
) (string, error) {
	dialogID, derr := q.CreateDialog(ctx, args.ChatUUID)
	if derr != nil {
		return "", fmt.Errorf("create dialog: %w", derr)
	}
	if _, err := q.AppendMessage(ctx, db.AppendMessageParams{
		ConversationID: args.ChatUUID, DialogID: dialogID, Role: "visitor", Body: args.Q,
		CitedWikiIds: []pgtype.UUID{}, CitedWritingIds: []pgtype.UUID{},
		CitedOutputIds: []pgtype.UUID{}, CitedSubjectivityIds: []pgtype.UUID{},
		// See above: NOT NULL, nil would go out as NULL.
		GroundedSubjectivityIds: []pgtype.UUID{},
	}); err != nil {
		return "", fmt.Errorf("append visitor message: %w", err)
	}
	if _, aerr := q.AppendMessage(ctx, db.AppendMessageParams{
		ConversationID: args.ChatUUID, DialogID: dialogID, Role: "assistant", Body: args.A,
		CitedWikiIds: args.WikiUUIDs, CitedWritingIds: args.WritingUUIDs,
		CitedOutputIds:          args.OutputUUIDs,
		CitedSubjectivityIds:    args.SubjUUIDs,
		GroundedSubjectivityIds: args.GroundedUUIDs,
		ToolCalls:               args.ToolCalls,
	}); aerr != nil {
		return "", fmt.Errorf("append assistant message: %w", aerr)
	}
	if berr := q.BumpConversation(ctx, args.ChatUUID); berr != nil {
		return "", fmt.Errorf("bump chat: %w", berr)
	}
	return pgstore.FormatUUID(dialogID), nil
}

// rollbackQuiet — for defer use. Rollback after a Commit returns ErrTxClosed, which is
// swallowed as normal.
func rollbackQuiet(ctx context.Context, tx pgx.Tx) {
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		// No logger available (the repo layer doesn't hold one); a rollback failure can only
		// be silent.
		_ = err
	}
}

// splitCitedIDs — splits Dialog.Citations by kind into wiki/writing/output/subjectivity
// id arrays (the persistence layer writes each to its own column). An unrecognized
// kind is dropped (silently).
type splitCitedIDs struct {
	Wiki         []string
	Writing      []string
	Output       []string
	Subjectivity []string
}

func splitCitations(cites []entity.Citation) splitCitedIDs {
	out := splitCitedIDs{
		Wiki:         make([]string, 0, len(cites)),
		Writing:      make([]string, 0, len(cites)),
		Output:       make([]string, 0, len(cites)),
		Subjectivity: make([]string, 0, len(cites)),
	}
	for i := range cites {
		appendCitedID(&out, cites[i])
	}
	return out
}

// appendCitedID — routes a Citation by genre to the wiki / writing / output /
// subjectivity column; other genres (raw / future additions) are dropped (not in the
// bucket map → no append). writing is a public blog, it always goes into cited (no
// gate); any subjectivity that reaches here has already passed the show_as_source gate.
func appendCitedID(acc *splitCitedIDs, c entity.Citation) {
	bucket := map[corpus.DocumentGenre]*[]string{
		corpus.GenreWiki:         &acc.Wiki,
		corpus.GenreWriting:      &acc.Writing,
		corpus.GenreOutput:       &acc.Output,
		corpus.GenreSubjectivity: &acc.Subjectivity,
	}[c.Genre]
	if bucket == nil {
		return // raw / a future genre: dropped when the caller passes one by mistake.
	}
	*bucket = append(*bucket, c.DocID)
}

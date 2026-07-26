// chats_dialog.go —— ChatRepo.AppendDialog (一个 Dialog → 2 行 messages
// 单事务原子) 实现细节。从 chats.go 拆出来守 max-lines 350 cap。
//
// 设计：caller 传 *conversation.Dialog；这里负责拆 citations、parse uuid、开 tx、
// 落 2 行 messages、bump conversation、commit。Bump / rollback / 错误翻译都
// 在这一个文件里。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// AppendDialog —— 一轮 Q-A 落 1 个 dialog + 2 条 message（挂 dialog_id）+ bump conversation，
// 单事务原子。dialog.Citations 拆成 wiki_ids / output_ids 落 assistant 那行。
// 返真 dialog id（dialogs 表；曾经借 assistant message id 冒充）。
func (r *ChatRepo) AppendDialog(
	ctx context.Context, chatID string, dialog *conversation.Dialog,
) (string, error) {
	chatUUID, perr := parseUUID(chatID)
	if perr != nil {
		return "", fmt.Errorf("parse chat id: %w", perr)
	}
	split := splitCitations(dialog.Citations)
	cited, cerr := parseCitedUUIDs(&split)
	if cerr != nil {
		return "", cerr
	}
	return r.runAppendDialogTx(ctx, &appendDialogTxArgs{
		ChatUUID: chatUUID, Q: dialog.Question, A: dialog.Answer,
		WikiUUIDs: cited.Wiki, WritingUUIDs: cited.Writing,
		OutputUUIDs: cited.Output, SubjUUIDs: cited.Subjectivity,
		ToolCalls: dialog.ToolCalls,
	})
}

// citedUUIDs —— splitCitedIDs 各组 parse 成 pgtype.UUID 后的打包。
type citedUUIDs struct {
	Wiki         []pgtype.UUID
	Writing      []pgtype.UUID
	Output       []pgtype.UUID
	Subjectivity []pgtype.UUID
}

// parseCitedUUIDs —— 四组 cited id string → pgtype.UUID,任一组解析失败即冒泡。
func parseCitedUUIDs(ids *splitCitedIDs) (citedUUIDs, error) {
	wiki, werr := parseUUIDArray(ids.Wiki)
	if werr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited wiki ids: %w", werr)
	}
	writing, wrerr := parseUUIDArray(ids.Writing)
	if wrerr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited writing ids: %w", wrerr)
	}
	output, oerr := parseUUIDArray(ids.Output)
	if oerr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited output ids: %w", oerr)
	}
	subj, serr := parseUUIDArray(ids.Subjectivity)
	if serr != nil {
		return citedUUIDs{}, fmt.Errorf("parse cited subjectivity ids: %w", serr)
	}
	return citedUUIDs{Wiki: wiki, Writing: writing, Output: output, Subjectivity: subj}, nil
}

// appendDialogTxArgs —— runAppendDialogTx 入参打包。字段顺序：ptr-tight
// 类型 (string 16B → slice 24B) 在前，UUID (无 ptr) 末尾 (govet
// fieldalignment 让 GC scan 区缩到最短)。
type appendDialogTxArgs struct {
	Q            string
	A            string
	WikiUUIDs    []pgtype.UUID
	WritingUUIDs []pgtype.UUID
	OutputUUIDs  []pgtype.UUID
	SubjUUIDs    []pgtype.UUID
	ToolCalls    []byte
	ChatUUID     pgtype.UUID
}

func (r *ChatRepo) runAppendDialogTx(
	ctx context.Context, args *appendDialogTxArgs,
) (string, error) {
	return r.runInTx(ctx, func(q *dbq.Queries) (string, error) {
		return runAppendDialogQueries(ctx, q, args)
	})
}

// runInTx —— 开 tx、跑 fn、commit；fn 返回的 dialog id 冒出来。DRY 掉两个 dialog 写路径的样板。
func (r *ChatRepo) runInTx(
	ctx context.Context, fn func(q *dbq.Queries) (string, error),
) (string, error) {
	tx, txErr := r.pool.Begin(ctx)
	if txErr != nil {
		return "", fmt.Errorf("begin tx: %w", txErr)
	}
	defer rollbackQuiet(ctx, tx)
	out, err := fn(dbq.New(tx))
	if err != nil {
		return "", err
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return "", fmt.Errorf("commit tx: %w", cerr)
	}
	return out, nil
}

// AppendVisitorOnly —— 失败轮（AI 没答）：建 1 个 dialog + 只落 visitor 那行（无成对 assistant）
// + bump，单事务。返 dialog id。dialog_id NOT NULL，所以失败轮也是一个「单-message」dialog，
// turn count（数 visitor message）仍准。
func (r *ChatRepo) AppendVisitorOnly(
	ctx context.Context, chatID, question string,
) (string, error) {
	chatUUID, perr := parseUUID(chatID)
	if perr != nil {
		return "", fmt.Errorf("parse chat id: %w", perr)
	}
	return r.runInTx(ctx, func(q *dbq.Queries) (string, error) {
		return runAppendVisitorOnlyQueries(ctx, q, chatUUID, question)
	})
}

func runAppendVisitorOnlyQueries(
	ctx context.Context, q *dbq.Queries, chatUUID pgtype.UUID, question string,
) (string, error) {
	dialogID, derr := q.CreateDialog(ctx, chatUUID)
	if derr != nil {
		return "", fmt.Errorf("create dialog: %w", derr)
	}
	if _, err := q.AppendMessage(ctx, dbq.AppendMessageParams{
		ConversationID: chatUUID, DialogID: dialogID, Role: "visitor", Body: question,
		CitedWikiIds: []pgtype.UUID{}, CitedWritingIds: []pgtype.UUID{},
		CitedOutputIds: []pgtype.UUID{}, CitedSubjectivityIds: []pgtype.UUID{},
	}); err != nil {
		return "", fmt.Errorf("append visitor message: %w", err)
	}
	if berr := q.BumpConversation(ctx, chatUUID); berr != nil {
		return "", fmt.Errorf("bump chat: %w", berr)
	}
	return formatUUID(dialogID), nil
}

// runAppendDialogQueries —— 在 tx 上跑 1 条 CreateDialog + 2 条 AppendMessage (挂 dialog_id) +
// 1 条 Bump，返真 dialog id。拆出来让 runAppendDialogTx cyclo ≤5 (open/commit + delegate)。
func runAppendDialogQueries(
	ctx context.Context, q *dbq.Queries, args *appendDialogTxArgs,
) (string, error) {
	dialogID, derr := q.CreateDialog(ctx, args.ChatUUID)
	if derr != nil {
		return "", fmt.Errorf("create dialog: %w", derr)
	}
	if _, err := q.AppendMessage(ctx, dbq.AppendMessageParams{
		ConversationID: args.ChatUUID, DialogID: dialogID, Role: "visitor", Body: args.Q,
		CitedWikiIds: []pgtype.UUID{}, CitedWritingIds: []pgtype.UUID{},
		CitedOutputIds: []pgtype.UUID{}, CitedSubjectivityIds: []pgtype.UUID{},
	}); err != nil {
		return "", fmt.Errorf("append visitor message: %w", err)
	}
	if _, aerr := q.AppendMessage(ctx, dbq.AppendMessageParams{
		ConversationID: args.ChatUUID, DialogID: dialogID, Role: "assistant", Body: args.A,
		CitedWikiIds: args.WikiUUIDs, CitedWritingIds: args.WritingUUIDs,
		CitedOutputIds:       args.OutputUUIDs,
		CitedSubjectivityIds: args.SubjUUIDs, ToolCalls: args.ToolCalls,
	}); aerr != nil {
		return "", fmt.Errorf("append assistant message: %w", aerr)
	}
	if berr := q.BumpConversation(ctx, args.ChatUUID); berr != nil {
		return "", fmt.Errorf("bump chat: %w", berr)
	}
	return formatUUID(dialogID), nil
}

// rollbackQuiet —— defer 用。Commit 之后 Rollback 返 ErrTxClosed，正常吞掉。
func rollbackQuiet(ctx context.Context, tx pgx.Tx) {
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		// 拿不到 logger (repo 层不持有)，rollback 失败只能 silent。
		_ = err
	}
}

// splitCitedIDs —— Dialog.Citations 按 kind 拆成 wiki/writing/output/subjectivity id
// 数组(持久层落各列)。kind 不识别的丢弃 (silent)。
type splitCitedIDs struct {
	Wiki         []string
	Writing      []string
	Output       []string
	Subjectivity []string
}

func splitCitations(cites []conversation.Citation) splitCitedIDs {
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

// appendCitedID —— Citation 按 genre 路由到 wiki / writing / output / subjectivity 列；
// 其他 genre (raw / 未来新加) 丢弃(bucket 表里没有 → 不 append)。writing 是 public blog,
// 一律进 cited(无 gate);subjectivity 能到这里的都已过 show_as_source gate。
func appendCitedID(acc *splitCitedIDs, c conversation.Citation) {
	bucket := map[corpusdomain.DocumentGenre]*[]string{
		corpusdomain.GenreWiki:         &acc.Wiki,
		corpusdomain.GenreWriting:      &acc.Writing,
		corpusdomain.GenreOutput:       &acc.Output,
		corpusdomain.GenreSubjectivity: &acc.Subjectivity,
	}[c.Genre]
	if bucket == nil {
		return // raw / 未来新加的 genre：caller 误传时丢弃。
	}
	*bucket = append(*bucket, c.DocID)
}

// dialog.go —— Dialog 一等公民。D-5 后 visitor pi-agent-core 在浏览器跑
// agent loop，backend 不再经 SendMessage 落消息。frontend turn 完成后调
// POST /sessions/{id}/dialogs 把这轮交换记下来。一个 dialog 含:
//   - 用户问句 (Question)
//   - AI 答 (Answer)
//   - AI 引用了哪些 corpus entry —— 按 **id** 引用 (Cited*IDs)
//
// 按 id 而非 path:地址是树派生的(见 corpus_tree_path),路径在 ACL 子集下可能
// 对不上;corpus_read 结果回 entry id,前端照原样回传,这里 GetByID 反查成
// Citation VO，走 ChatRepo.AppendDialog (单事务两行 messages + bump，原子)。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/corpus"
)

// DialogCorpusLookup —— Dialog cited 反查 entry 的窄接口。*postgres.Corpus
// facade 满足:Get(ctx, ownerID, "<genre>://<id>") 内部 isUUID → GetByID
// (见 corpus_facade)。
//
// 不直接用 postgres.Corpus 类型 (publicroutes 不能 import postgres)，靠
// 接口模式让 mcp / publicroutes 这两个组件都能传它。
type DialogCorpusLookup interface {
	Get(ctx context.Context, ownerID, uri string) (corpus.Document, error)
}

// DialogDeps —— RecordDialog 需要的依赖。Subjectivity 单独一个 lookup（不走 Corpus facade——
// facade 只 dispatch 4 个 genre，subjectivity 不在内），gate show_as_source 用。nil = 不解析
// subjectivity cite（无 subjectivity 装配的调用方）。
type DialogDeps struct {
	Chats        *conversation.ChatRepo
	Corpus       DialogCorpusLookup
	Subjectivity SubjectivityCiteLookup
	Log          *slog.Logger
}

// RecordDialogInput —— 一个 dialog 完成后落到 transcript 的入参。
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

// RecordDialog —— cited id 反查成 Citation → 构造 Dialog → ChatRepo.AppendDialog
// 原子落地。Answer 空 **且无 tool_calls** 时只落 question(纯出错的 dialog 也想留用户问句)。
//
// F-A-19: 一个 return_directly 工具(summarize / booking / ask_visitor)的产物就是那条 tool
// 结果(报告卡),没有 answer 文本 —— 但它是完整的一轮,assistant message 必须带 tool_calls 落库,
// 否则 reload 后访客丢了自己生成的报告。所以「空 answer」不再等于「只落 visitor」:有 tool_calls
// 就走完整 AppendDialog(空 body + tool_calls),restore 侧 pairDialogs 据 tool_calls 收它。
func RecordDialog(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) error {
	if in.Answer == "" && !toolCallsNonEmpty(in.ToolCalls) {
		return appendVisitorOnly(ctx, deps, in)
	}
	cites := resolveCitations(ctx, deps, in)
	dlg := conversation.NewDialog(&conversation.DialogInit{
		ChatID: in.ConversationID, Question: in.Question, Answer: in.Answer,
		Citations: cites, ToolCalls: in.ToolCalls, CreatedAt: time.Now(),
	})
	if _, err := deps.Chats.AppendDialog(ctx, in.ConversationID, &dlg); err != nil {
		return fmt.Errorf("append dialog: %w", err)
	}
	return nil
}

// appendVisitorOnly —— answer 空时只落 visitor 那行 (用于 error 路径)。失败轮也是一个
// 「单-message」dialog（dialog_id NOT NULL），走 AppendVisitorOnly 单事务建 dialog + 1 message。
func appendVisitorOnly(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) error {
	if _, err := deps.Chats.AppendVisitorOnly(ctx, in.ConversationID, in.Question); err != nil {
		return fmt.Errorf("append visitor message: %w", err)
	}
	return nil
}

// resolveCitations —— 把 frontend 传的 cited id 数组反查成 Citation VO
// (genre + doc_id + uri + title)。lookup 失败的丢弃 (不阻塞 dialog 落)。
func resolveCitations(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) []conversation.Citation {
	cites := make([]conversation.Citation, 0,
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
	return appendSubjectivityCitations(ctx, deps, in.OwnerID, in.CitedSubjectivityIDs, cites)
}

// appendSubjectivityCitations —— subjectivity id → Citation，**gate 在 show_as_source**：
// 逐个反查，仅 show_as_source=true 的进 cited（默认私有的丢弃）。server-authoritative：
// 不信 client，源头查 DB。lookup 未注入 / 未命中 → 略过（不阻塞 dialog 落）。
func appendSubjectivityCitations(
	ctx context.Context, deps *DialogDeps, ownerID string, ids []string,
	acc []conversation.Citation,
) []conversation.Citation {
	if deps.Subjectivity == nil {
		return acc
	}
	for _, id := range ids {
		ref, err := deps.Subjectivity.ResolveCite(ctx, ownerID, id)
		if err != nil {
			logIfUnexpectedNotFound(deps.Log, err, corpus.GenreSubjectivity, id)
			continue
		}
		if !ref.ShowAsSource {
			continue // 私有：ground 了 voice 但不进 visitor footer。
		}
		acc = append(acc, conversation.Citation{
			Genre: corpus.GenreSubjectivity, DocID: ref.ID,
			Path: ref.Path, Title: ref.Title,
		})
	}
	return acc
}

// resolveCiteArgs —— 一组 entry id 用同样 (owner, genre) 反查 Citation 的入
// 参。打包让 appendResolvedCitations 参数控在 5 个以内 (revive)。字段按
// ptr-density 排：strings 在前，slice 后 (govet fieldalignment 让 ptr 段
// 连续)。
type resolveCiteArgs struct {
	OwnerID string
	Genre   corpus.DocumentGenre
	IDs     []string
}

// appendResolvedCitations —— 一组 entry id → Citation 反查。统一走 Corpus
// facade:Get(`<genre>://<id>`) 内部 isUUID → GetByID(见 corpus_facade)。按 id
// 引用稳:不受树路径在 ACL 子集下对不上影响。corpus 没注入时返空。
func appendResolvedCitations(
	ctx context.Context, deps *DialogDeps, args *resolveCiteArgs,
	acc []conversation.Citation,
) []conversation.Citation {
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
		acc = append(acc, conversation.Citation{
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
	// dialog cited 覆盖 wiki + writing + output + subjectivity；其他 genre (raw) 返 nil，
	// errors.Is(err, nil) 恒 false → 任何 err 都算 unexpected 并记一行。
	return map[corpus.DocumentGenre]error{
		corpus.GenreWiki:         corpus.ErrWikiNotFound,
		corpus.GenreWriting:      corpus.ErrWritingNotFound,
		corpus.GenreOutput:       corpus.ErrOutputNotFound,
		corpus.GenreSubjectivity: corpus.ErrSubjectivityNotFound,
	}[g]
}

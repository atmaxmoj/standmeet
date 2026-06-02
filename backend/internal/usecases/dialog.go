// dialog.go —— Dialog 一等公民。D-5 后 visitor pi-agent-core 在浏览器跑
// agent loop，backend 不再经 SendMessage 落消息。frontend turn 完成后调
// POST /sessions/{id}/dialogs 把这轮交换记下来。一个 dialog 含:
//   - 用户问句 (Question)
//   - AI 答 (Answer)
//   - AI 引用了哪些 corpus path (Cited*Paths)
//
// usecase 把 path 反成 Citation VO，走 ChatRepo.AppendDialog (单事务两
// 行 messages 行 + bump，原子)。dialog 是逻辑聚合，落地拆 2 行是 repo
// mapper 关心的事。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// DialogCorpusLookup —— Dialog cited 把 path 反成 entry id 的窄接口。
// *postgres.Corpus facade 满足: 走 Get(ctx, ownerID, "<genre>://<path>")
// 内部走 WikiRepo.GetByPath / OutputRepo.GetByPath (不过滤 seo_indexed)。
//
// 不直接用 postgres.Corpus 类型 (publicroutes 不能 import postgres)，靠
// 接口模式让 mcp / publicroutes 这两个组件都能传它。
type DialogCorpusLookup interface {
	Get(ctx context.Context, ownerID, uri string) (domain.Document, error)
}

// DialogDeps —— RecordDialog 需要的依赖。
type DialogDeps struct {
	Chats  *postgres.ChatRepo
	Corpus DialogCorpusLookup
	Log    *slog.Logger
}

// RecordDialogInput —— 一个 dialog 完成后落到 transcript 的入参。
type RecordDialogInput struct {
	OwnerID          string
	ConversationID   string
	Question         string
	Answer           string
	CitedWikiPaths   []string
	CitedOutputPaths []string
}

// RecordDialog —— path 反查成 Citation → 构造 Dialog → ChatRepo.AppendDialog
// 原子落地。Answer 空时只落 question (出错的 dialog 也想留下用户问句)。
func RecordDialog(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) error {
	if in.Answer == "" {
		return appendVisitorOnly(ctx, deps, in)
	}
	cites := resolveCitations(ctx, deps, in)
	dlg := domain.NewDialog(in.ConversationID, in.Question, in.Answer, cites, time.Now())
	if _, err := deps.Chats.AppendDialog(ctx, in.ConversationID, &dlg); err != nil {
		return fmt.Errorf("append dialog: %w", err)
	}
	return nil
}

// appendVisitorOnly —— answer 空时只落 visitor 那行 (用于 error 路径)；
// 走 row-level AppendMessage 是因为没成对的 assistant 配，没必要拉事务。
func appendVisitorOnly(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) error {
	if _, err := deps.Chats.AppendMessage(ctx, &postgres.AppendMessageInput{
		ConversationID: in.ConversationID, Role: "visitor", Body: in.Question,
	}); err != nil {
		return fmt.Errorf("append visitor message: %w", err)
	}
	return nil
}

// resolveCitations —— 把 frontend 传的 path 数组反查成 Citation VO
// (kind + doc_id + path + title)。lookup 失败的丢弃 (不阻塞 dialog 落)。
func resolveCitations(
	ctx context.Context, deps *DialogDeps, in *RecordDialogInput,
) []domain.Citation {
	cites := make([]domain.Citation, 0, len(in.CitedWikiPaths)+len(in.CitedOutputPaths))
	cites = appendResolvedCitations(ctx, deps, &resolveCiteArgs{
		OwnerID: in.OwnerID, Paths: in.CitedWikiPaths,
		Genre: domain.GenreWiki,
	}, cites)
	cites = appendResolvedCitations(ctx, deps, &resolveCiteArgs{
		OwnerID: in.OwnerID, Paths: in.CitedOutputPaths,
		Genre: domain.GenreOutput,
	}, cites)
	return cites
}

// resolveCiteArgs —— 一组 path 用同样 (owner, genre) 反查 Citation 的入
// 参。打包让 appendResolvedCitations 参数控在 5 个以内 (revive)。字段按
// ptr-density 排：strings 在前，slice 后 (govet fieldalignment 让 ptr 段
// 连续)。
type resolveCiteArgs struct {
	OwnerID string
	Genre   domain.DocumentGenre
	Paths   []string
}

// appendResolvedCitations —— 通用 path → Citation 反查。统一走 Corpus
// facade (URI resolver)。corpus 没注入时返空。
func appendResolvedCitations(
	ctx context.Context, deps *DialogDeps, args *resolveCiteArgs,
	acc []domain.Citation,
) []domain.Citation {
	if deps.Corpus == nil {
		return acc
	}
	for _, p := range args.Paths {
		uri := domain.FormatURI(args.Genre, p)
		doc, err := deps.Corpus.Get(ctx, args.OwnerID, uri)
		if err != nil {
			logIfUnexpectedNotFound(deps.Log, err, args.Genre, p)
			continue
		}
		acc = append(acc, domain.Citation{
			Genre: args.Genre, DocID: doc.ID(), Path: p, Title: doc.Title(),
		})
	}
	return acc
}

func logIfUnexpectedNotFound(
	log *slog.Logger, err error, genre domain.DocumentGenre, path string,
) {
	if errors.Is(err, notFoundForGenre(genre)) {
		return
	}
	log.Warn("dialog cited lookup", "genre", genre, "path", path, "err", err)
}

func notFoundForGenre(g domain.DocumentGenre) error {
	// dialog cited 只覆盖 wiki + output；其他 genre 返 nil errors.Is 自然
	// 走 fallthrough。
	switch g {
	case domain.GenreWiki:
		return domain.ErrWikiNotFound
	case domain.GenreOutput:
		return domain.ErrOutputNotFound
	case domain.GenreRaw, domain.GenreWriting:
		return nil
	}
	return nil
}

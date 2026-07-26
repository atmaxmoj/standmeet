// conversations.go —— admin 视角的 conversation list / transcript 查询。
// 业务逻辑薄到几乎只是 repo 转发 + 默认参数 clamp；这里独立成 use case 是
// 为了和 routes 层解耦，未来加 "filter / search / pagination" 不污染 handler。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/corpus"
)

// ConversationsDeps —— ListConversations / GetTranscript 需要的 repo。
// Wiki + Writing + Output 是给 transcript 把 cited_*_ids 解到 id+title 用；Subjectivity 解
// cited_subjectivity_ids（仅 opt-in 的会落进 message，此处只做 id→ref 展示）。
type ConversationsDeps struct {
	Chats        *conversation.ChatRepo
	Wiki         *corpus.WikiRepo
	Writing      *corpus.WritingRepo
	Output       *corpus.OutputRepo
	Subjectivity SubjectivityCiteLookup
}

// TitledRef —— TranscriptBundle 暴露的 (id, title)；上层 (routes / mcp)
// 不直接 import postgres，所以 usecases 给一个对应类型。字段跟
// postgres.TitledRef 同名同序，转换是字段-by-字段。
type TitledRef struct {
	ID    string
	Title string
	Path  string
}

// SubjectivityRef —— transcript 里 opt-in subjectivity 的解析 ref。带 Body（subjectivity_refs
// 暴露 {id,path,title,body}）——只有 show_as_source=true 的才进 message.cited_subjectivity_ids，
// 故这里出现的 body 一定是 owner 明确 opt-in 的，非私有泄漏。
type SubjectivityRef struct {
	ID    string
	Title string
	Path  string
	Body  string
}

// TranscriptBundle —— GetConversationTranscript 返：conversation + messages
// + cited wiki / output / subjectivity 的 id→ref 索引（hydration 一次性，前端按需查）。
type TranscriptBundle struct {
	ConvBundle       conversation.ChatWithMessages
	WikiRefs         []TitledRef
	WritingRefs      []TitledRef
	OutputRefs       []TitledRef
	SubjectivityRefs []SubjectivityRef
}

const (
	defaultConvListLimit = 50
	maxConvListLimit     = 200
)

// ListConversations —— admin 列 owner 所有 conversation。limit ≤ 0 用默认；
// 超 max 截断。
func ListConversations(
	ctx context.Context, deps ConversationsDeps, ownerID string, limit int32,
) ([]conversation.ChatSummary, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Chats.ListByOwner(ctx, ownerID, clampConvLimit(limit))
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	return rows, nil
}

// GetConversationTranscript —— 拿 conversation + messages 全量 + hydrate
// 出 cited wiki/output 的 title 索引。convID 不存在 / 不属于 owner 返
// domain.ErrConversationNotFound。Hydrate 失败不致命：refs 返空，前端
// fallback 显 id。
func GetConversationTranscript(
	ctx context.Context, deps ConversationsDeps, ownerID, convID string,
) (TranscriptBundle, error) {
	if ownerID == "" || convID == "" {
		return TranscriptBundle{}, apierr.ErrEmptyField
	}
	bundle, err := deps.Chats.GetWithMessages(ctx, ownerID, convID)
	if err != nil {
		return TranscriptBundle{}, fmt.Errorf("get transcript: %w", err)
	}
	cited := collectCitedIDs(bundle.Messages)
	subjRefs := subjectivityCitedRefs(ctx, deps.Subjectivity, ownerID, cited.subjectivities)
	return TranscriptBundle{
		ConvBundle:       bundle,
		WikiRefs:         wikiCitedRefs(ctx, deps.Wiki, ownerID, cited.wikis),
		WritingRefs:      writingCitedRefs(ctx, deps.Writing, ownerID, cited.writings),
		OutputRefs:       outputCitedRefs(ctx, deps.Output, ownerID, cited.outputs),
		SubjectivityRefs: subjRefs,
	}, nil
}

// subjectivityCitedRefs —— cited subjectivity id → {id,path,title,body}。这些 id 已是 opt-in
// 的（写入 message 前过了 show_as_source gate），此处纯 hydrate。lookup 未注入 / 解析失败 → 略过。
func subjectivityCitedRefs(
	ctx context.Context, lookup SubjectivityCiteLookup, ownerID string, ids []string,
) []SubjectivityRef {
	out := make([]SubjectivityRef, 0, len(ids))
	if lookup == nil {
		return out
	}
	for _, id := range ids {
		ref, err := lookup.ResolveCite(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, SubjectivityRef{
			ID: ref.ID, Title: ref.Title, Path: ref.Path, Body: ref.Body,
		})
	}
	return out
}

// wikiCitedRefs —— 把 cited wiki id 解成 (id, title, 树派生 path)。地址纯树派生
// (load 全树 → WikiTreePaths),不读已退役的 path 列。load 失败 / id 已删 → 略过,
// transcript 主数据已在手,前端 fallback 显 id,不该让整个 transcript 502。
func wikiCitedRefs(
	ctx context.Context, repo *corpus.WikiRepo, ownerID string, ids []string,
) []TitledRef {
	// 只对真 cited 的 id 逐个上溯算 path + meta(无 50-cap;超出内存窗口的也算得出)。
	titles := make(map[string]string, len(ids))
	paths := make(map[string]string, len(ids))
	for _, id := range ids {
		meta, merr := repo.GetMetaByID(ctx, ownerID, id)
		if merr != nil {
			continue
		}
		path, perr := wikiPathByID(ctx, repo, ownerID, id)
		if perr != nil {
			continue
		}
		titles[id] = meta.Title
		paths[id] = path
	}
	return refsFor(ids, titles, paths)
}

// writingCitedRefs —— cited writing id 解成 (id, title, path)。writing 自带 slug 派生的
// path 列("writings/"+slug),不用上溯树;逐个 GetByID 拿 title+slug。写不进 message 前
// 无 gate（writing 是 public/已发布 blog）。repo 未注入 / id 已删 → 略过。
func writingCitedRefs(
	ctx context.Context, repo *corpus.WritingRepo, ownerID string, ids []string,
) []TitledRef {
	out := make([]TitledRef, 0, len(ids))
	if repo == nil {
		return out
	}
	for _, id := range ids {
		w, err := repo.GetByID(ctx, ownerID, id)
		if err != nil {
			continue
		}
		out = append(out, TitledRef{ID: id, Title: w.Title(), Path: w.Path()})
	}
	return out
}

// outputCitedRefs —— wiki 的 output 孪生:逐个 cited id 上溯算 path + meta(无 50-cap;
// 超出内存窗口的 cited output 也解得出)。
func outputCitedRefs(
	ctx context.Context, repo *corpus.OutputRepo, ownerID string, ids []string,
) []TitledRef {
	titles := make(map[string]string, len(ids))
	paths := make(map[string]string, len(ids))
	for _, id := range ids {
		meta, merr := repo.GetMetaByID(ctx, ownerID, id)
		if merr != nil {
			continue
		}
		path, perr := outputPathByID(ctx, repo, ownerID, id)
		if perr != nil {
			continue
		}
		titles[id] = meta.Title
		paths[id] = path
	}
	return refsFor(ids, titles, paths)
}

// refsFor —— cited id → TitledRef,按 title/path 表填;不在表里(已删)的略过,
// 保持旧 GetTitlesByIDs「只回存在的」语义。
func refsFor(ids []string, titles, paths map[string]string) []TitledRef {
	out := make([]TitledRef, 0, len(ids))
	for _, id := range ids {
		title, ok := titles[id]
		if !ok {
			continue
		}
		out = append(out, TitledRef{ID: id, Title: title, Path: paths[id]})
	}
	return out
}

// citedIDs —— collectCitedIDs 的各组返结果，避开 named-return + 多-return。
type citedIDs struct {
	wikis          []string
	writings       []string
	outputs        []string
	subjectivities []string
}

const citedSetInitialCap = 16

// collectCitedIDs —— 扫所有 message 的 CitedWikiIDs / CitedWritingIDs / CitedOutputIDs /
// CitedSubjectivityIDs，去重。
func collectCitedIDs(messages []conversation.Message) citedIDs {
	wikiSet := make(map[string]struct{}, citedSetInitialCap)
	writingSet := make(map[string]struct{}, citedSetInitialCap)
	outputSet := make(map[string]struct{}, citedSetInitialCap)
	subjSet := make(map[string]struct{}, citedSetInitialCap)
	for i := range messages {
		addAll(wikiSet, messages[i].CitedWikiIDs)
		addAll(writingSet, messages[i].CitedWritingIDs)
		addAll(outputSet, messages[i].CitedOutputIDs)
		addAll(subjSet, messages[i].CitedSubjectivityIDs)
	}
	return citedIDs{
		wikis: keysOf(wikiSet), writings: keysOf(writingSet),
		outputs: keysOf(outputSet), subjectivities: keysOf(subjSet),
	}
}

func addAll(set map[string]struct{}, ids []string) {
	for _, id := range ids {
		set[id] = struct{}{}
	}
}

func keysOf(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	return out
}

func clampConvLimit(n int32) int32 {
	if n <= 0 {
		return defaultConvListLimit
	}
	if n > maxConvListLimit {
		return maxConvListLimit
	}
	return n
}

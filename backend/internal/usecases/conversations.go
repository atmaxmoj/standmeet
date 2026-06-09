// conversations.go —— admin 视角的 conversation list / transcript 查询。
// 业务逻辑薄到几乎只是 repo 转发 + 默认参数 clamp；这里独立成 use case 是
// 为了和 routes 层解耦，未来加 "filter / search / pagination" 不污染 handler。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// ConversationsDeps —— ListConversations / GetTranscript 需要的 repo。
// Wiki + Output 是给 transcript 把 cited_*_ids 解到 id+title 用。
type ConversationsDeps struct {
	Chats  *postgres.ChatRepo
	Wiki   *postgres.WikiRepo
	Output *postgres.OutputRepo
}

// TitledRef —— TranscriptBundle 暴露的 (id, title)；上层 (routes / mcp)
// 不直接 import postgres，所以 usecases 给一个对应类型。字段跟
// postgres.TitledRef 同名同序，转换是字段-by-字段。
type TitledRef struct {
	ID    string
	Title string
	Path  string
}

// TranscriptBundle —— GetConversationTranscript 返：conversation + messages
// + cited wiki / output 的 id→title 索引（hydration 一次性，前端按需查）。
type TranscriptBundle struct {
	ConvBundle postgres.ChatWithMessages
	WikiRefs   []TitledRef
	OutputRefs []TitledRef
}

const (
	defaultConvListLimit = 50
	maxConvListLimit     = 200
)

// ListConversations —— admin 列 owner 所有 conversation。limit ≤ 0 用默认；
// 超 max 截断。
func ListConversations(
	ctx context.Context, deps ConversationsDeps, ownerID string, limit int32,
) ([]postgres.ChatSummary, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
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
		return TranscriptBundle{}, ErrEmptyField
	}
	bundle, err := deps.Chats.GetWithMessages(ctx, ownerID, convID)
	if err != nil {
		return TranscriptBundle{}, fmt.Errorf("get transcript: %w", err)
	}
	cited := collectCitedIDs(bundle.Messages)
	return TranscriptBundle{
		ConvBundle: bundle,
		WikiRefs:   wikiCitedRefs(ctx, deps.Wiki, ownerID, cited.wikis),
		OutputRefs: outputCitedRefs(ctx, deps.Output, ownerID, cited.outputs),
	}, nil
}

// wikiCitedRefs —— 把 cited wiki id 解成 (id, title, 树派生 path)。地址纯树派生
// (load 全树 → wikiTreePaths),不读已退役的 path 列。load 失败 / id 已删 → 略过,
// transcript 主数据已在手,前端 fallback 显 id,不该让整个 transcript 502。
func wikiCitedRefs(
	ctx context.Context, repo *postgres.WikiRepo, ownerID string, ids []string,
) []TitledRef {
	wikis, err := repo.ListByOwner(ctx, ownerID, maxRAGWikis)
	if err != nil {
		return []TitledRef{}
	}
	paths := wikiTreePaths(wikis)
	titles := make(map[string]string, len(wikis))
	for i := range wikis {
		titles[wikis[i].ID()] = wikis[i].Title()
	}
	return refsFor(ids, titles, paths)
}

// outputCitedRefs —— wiki 的 output 孪生:同样纯树派生地址。
func outputCitedRefs(
	ctx context.Context, repo *postgres.OutputRepo, ownerID string, ids []string,
) []TitledRef {
	outputs, err := repo.ListByOwner(ctx, ownerID, maxRAGOutputs)
	if err != nil {
		return []TitledRef{}
	}
	paths := outputTreePaths(outputs)
	titles := make(map[string]string, len(outputs))
	for i := range outputs {
		titles[outputs[i].ID()] = outputs[i].Title()
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

// citedIDs —— collectCitedIDs 的两组返结果，避开 named-return + 3-return。
type citedIDs struct {
	wikis   []string
	outputs []string
}

const citedSetInitialCap = 16

// collectCitedIDs —— 扫所有 message 的 CitedWikiIDs / CitedOutputIDs，去重。
func collectCitedIDs(messages []domain.Message) citedIDs {
	wikiSet := make(map[string]struct{}, citedSetInitialCap)
	outputSet := make(map[string]struct{}, citedSetInitialCap)
	for i := range messages {
		for _, id := range messages[i].CitedWikiIDs {
			wikiSet[id] = struct{}{}
		}
		for _, id := range messages[i].CitedOutputIDs {
			outputSet[id] = struct{}{}
		}
	}
	return citedIDs{wikis: keysOf(wikiSet), outputs: keysOf(outputSet)}
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

// agentskills_retrieval.go —— Phase B-2: RetrievalCapability。Capability 形态
// 包住 buildRetriever + retriever struct，让 visitor chat tools 统一从
// agentskills.Registry 装配。
//
// 一个 capability，3 个 tool (corpus.search / corpus.read / corpus.list)。
// Cited closure 暴露 retriever 内部 collector 让 emitDoneEvent 拿真读过
// 的 entry 列表，去掉 streamReply 直接持 *retriever 的耦合。

package usecases

import (
	"context"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
)

const capRetrievalID = "corpus.retrieval"

// retrievalCapability —— Capability impl，持 wiki/output/writings repos
// 闭包。VisitorBinding 每次新建一个 retriever（带新 collector），多个
// session 互不干扰。
type retrievalCapability struct {
	deps *VisitorDeps
}

func newRetrievalCapability(deps *VisitorDeps) *retrievalCapability {
	return &retrievalCapability{deps: deps}
}

func (*retrievalCapability) ID() string               { return capRetrievalID }
func (*retrievalCapability) Shape() agentskills.Shape { return agentskills.ShapeVisitorOnly }
func (*retrievalCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	// retrieval 不双暴露；owner 自己有 corpus admin 入口，不通过 MCP 调
	// search/read/list。
	return []*agentskills.MCPBinding{}
}

func (*retrievalCapability) SystemPromptFragment(
	_ context.Context, in *agentskills.AssembleInput,
) string {
	if !retrievalEnabled(in.RoleSnapshot) {
		return ""
	}
	return "You have three tools for accessing the owner's curated corpus:\n" +
		"  • corpus.search(query) — find entries matching a keyword;\n" +
		"  • corpus.read(path)    — fetch the full body of one entry;\n" +
		"  • corpus.list(prefix?) — browse entries by path prefix.\n\n" +
		"When the visitor's question relates to the owner's work / projects / " +
		"opinions, search first, read the most relevant entries, then answer. " +
		"Quote output entries verbatim when they fit; paraphrase wiki entries."
}

// retrievalEnabled —— role 是否含任何 corpus URI；空 = capability 暴露
// 但 enabled=false（前端渲降级提示）。
func retrievalEnabled(snapshot *domain.RoleSnapshot) bool {
	if snapshot == nil {
		return false
	}
	return len(snapshot.CorpusURIs()) > 0
}

// VisitorBinding —— 装配本 session 的 retrieval binding。dev endpoint 跟
// real SendMessage 走同路径：load corpus → 新建 retriever → 把 3 个 tool
// 绑到 retriever.Execute。
func (c *retrievalCapability) VisitorBinding(
	ctx context.Context, in *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	retr, err := buildRetriever(ctx, c.deps, &retrieverBuildInput{
		ownerID: in.OwnerID, snapshot: in.RoleSnapshot,
	})
	if err != nil {
		return nil, err
	}
	return &agentskills.Binding{
		Tools: liveRetrievalTools(retr),
		State: agentskills.CapabilityState{
			ID: capRetrievalID, Enabled: retrievalEnabled(in.RoleSnapshot),
		},
		Cited: retrievalCitedClosure(retr),
	}, nil
}

// liveRetrievalTools —— 每个 tool 绑到 retriever 对应方法。retriever.Execute
// 内部 switch by name 已存在，复用之让 3 个 tool 都路由到同一 executor 入口。
func liveRetrievalTools(r *retriever) []agentskills.BindingTool {
	specs := retrievalToolSpecs()
	out := make([]agentskills.BindingTool, 0, len(specs))
	for _, s := range specs {
		out = append(out, agentskills.BindingTool{Spec: s, Execute: r.Execute})
	}
	return out
}

func retrievalCitedClosure(r *retriever) func() agentskills.CitedSnapshot {
	return func() agentskills.CitedSnapshot {
		wikis, outputs := r.collector.snapshot()
		return agentskills.CitedSnapshot{Wikis: wikis, Outputs: outputs}
	}
}

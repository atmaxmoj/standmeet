// capreg_retrieval.go —— corpus.retrieval 外置后留在 core 的 host 侧依赖声明。
// 能力本体（3 个 MCP tool / binding / prompt）已外置成沙箱插件 mcp-servers/retrieval，
// 经 sandbox_stdio 以 origin=builtin 加载；它断网，靠 bind 进沙箱的窄 socket
// （retrieval.sock）回调 host ops 跑真活（capreg_retrieval_socket.go）。
//
// retriever 业务逻辑（buildRetriever + runSearch/runRead/runList，在 visitor_chat*.go）
// 原封不动复用，只是 invoke 从 in-process BindingTool 换成 socket op handler。citation
// 不经能力：inference 的 accumSink 从 corpus_read 结果 {id,genre} 自行累计（早已解耦，
// 旧 Binding.Cited closure 是死代码，随本次一并删）。

package usecases

import (
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// RetrievalDeps —— 窄依赖(#131):corpus 四类 lister(wiki/output/writing/subjectivity)。
// composition root 建一份喂 RegisterRetrievalSocket。
type RetrievalDeps struct {
	Wiki         WikiLister
	Output       OutputLister
	Writings     WritingLister
	Subjectivity *postgres.NoteRepo
	VaultSync    *postgres.VaultSyncRepo // 原生 standmeet-query 解析(跨-genre QueryNotes)
}

// RetrievalScopeVisible —— retrieval 的 fragment/enabled 闸：role snapshot 有任何 corpus
// URI = 活跃（prompt 贡献 + CapabilityState.Enabled=true）。空 scope → fragment 不进
// prompt + enabled=false，但 3 个 tool 仍暴露（ACL=always；内部 AllowsCorpus 对空白名单
// 恒 deny）。沿用旧 retrievalEnabled 语义。composition root 经 CapHooks.Fragment 注入。
func RetrievalScopeVisible(in *capreg.AssembleInput) bool {
	return len(corpusURIsOf(in)) > 0
}

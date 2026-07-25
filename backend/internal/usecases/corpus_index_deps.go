// corpus_index_deps.go —— corpus indexing 的 host 侧依赖(corpus listers)+ scope 闸。
// 这是 corpus 自己伸出去的检索/导航接口(search/tree/read over 自己的内容)——core，corpus 拥有它。
// 消费方(外置沙箱插件，如 corpus 检索 / 会话摘要)断网，靠 bind 进沙箱的窄 socket 回调这些
// corpus_* host op 跑真活(corpus_index_socket.go)。能力本体(MCP tool / binding / prompt)在插件侧。
//
// corpus 业务逻辑(runSearch/runRead/runList，在 visitor_chat*.go)原封不动复用，只是 invoke 从
// in-process BindingTool 换成 socket op handler。citation 不经能力:inference 的 accumSink 从
// corpus_read 结果 {id,genre} 自行累计(早已解耦)。

package usecases

import (
	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/search"
)

// CorpusIndexDeps —— 窄依赖(#131):corpus 四类 lister(wiki/output/writing/subjectivity)。
// composition root 建一份喂 RegisterCorpusIndexSocket。
type CorpusIndexDeps struct {
	Wiki         WikiLister
	Output       OutputLister
	Writings     WritingLister
	Subjectivity *postgres.NoteRepo
	VaultSync    *postgres.VaultSyncRepo // standmeet-query 解析 + corpus_links 取邻居 genre/path
	NoteRefs     *postgres.NoteRefRepo   // corpus_links 顺 note_refs 取 outgoing/backlinks
	Searcher     *search.Client          // Meili 词法后端;nil → corpus_search 退 Postgres 全文
}

// CorpusScopeVisible —— corpus 检索能力的 fragment/enabled 闸：role snapshot 有任何 corpus
// URI = 活跃（prompt 贡献 + CapabilityState.Enabled=true）。空 scope → fragment 不进
// prompt + enabled=false，但 tool 仍暴露（ACL=always；内部 AllowsCorpus 对空白名单
// 恒 deny）。composition root 经 CapHooks.Fragment 注入。
func CorpusScopeVisible(in *capreg.AssembleInput) bool {
	return len(corpusURIsOf(in)) > 0
}

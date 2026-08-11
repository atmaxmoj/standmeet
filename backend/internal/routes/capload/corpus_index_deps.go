// corpus_index_deps.go —— corpus indexing 的 host 侧依赖(corpus listers)+ scope 闸。
// 这是 corpus 自己伸出去的检索/导航接口(search/tree/read over 自己的内容)——core，corpus 拥有它。
// 消费方(外置沙箱插件，如 corpus 检索 / 会话摘要)断网，靠 bind 进沙箱的窄 socket 回调这些
// corpus_* host op 跑真活(corpus_index_socket.go)。能力本体(MCP tool / binding / prompt)在插件侧。
//
// corpus 业务逻辑(runSearch/runRead/runList，在 visitor_chat*.go)原封不动复用，只是 invoke 从
// in-process BindingTool 换成 socket op handler。citation 不经能力:inference 的 accumSink 从
// corpus_read 结果 {id,genre} 自行累计(早已解耦)。

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// CorpusScopeVisible —— corpus 检索能力的 fragment/enabled 闸：这个 session 的身份**够得着
// 语料**就算活跃（prompt 贡献 + CapabilityState.Enabled=true）。够不着 → fragment 不进
// prompt + enabled=false，但 tool 仍暴露（ACL=always；内部准入照样逐条判）。
// composition root 经 CapHooks.Fragment 注入。
//
// 判据问的是 scope 自己（`ReachesAnything`），不是"正列表长度 > 0"：public 身份的范围由
// 每条笔记的 published 定，它一条 glob 都没有 —— 按长度判会把检索能力对每个无码访客关掉。
func CorpusScopeVisible(in *capreg.AssembleInput) bool {
	if in.RoleSnapshot == nil {
		return false
	}
	return in.RoleSnapshot.CorpusScope().ReachesAnything()
}

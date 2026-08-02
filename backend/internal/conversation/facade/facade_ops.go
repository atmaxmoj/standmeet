// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/conversation/ops。

package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/ops"

// 声明操作时要的类型（实现:ops）.
type (
	OpsConversations = ops.ConversationsDeps
	// OpsHost —— 入站(沙箱回头问宿主)那几件事要的依赖包。
	OpsHost = ops.HostDeps
)

// 操作组（实现:ops）.
var (
	ConversationOps = ops.Conversations
	// HostOps —— 开给沙箱能力的:读逐字稿 / 借 LLM 生成 / 存报告。
	HostOps = ops.HostOps
)

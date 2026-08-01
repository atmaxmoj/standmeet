// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/conversation/ops。

package conversation

import "github.com/atmaxmoj/standmeet/internal/conversation/ops"

// 声明操作时要的类型（实现:ops）.
type OpsConversations = ops.ConversationsDeps

// 操作组（实现:ops）.
var ConversationOps = ops.Conversations

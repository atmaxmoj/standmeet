// summarize_gateway.go —— 把 summarize 沙箱要的三个**核心资源** op 挂上它的 socket。summarize 的
// 报告生成逻辑全在沙箱(mcp-servers/summarize)里；host 只出借它够不到的资源,每个 op 的 handler 都
// 住在**自己的业务域**里(不进机制 bucket):conversation.read / inference.generate / report.store 三个
// 都在 usecases 跟各自的域代码一起。cmd 只按 summarize 需要的这三个拼。summarize 不碰 connector/
// capstore/owner,所以它的 socket 上就没有那些 op。

package main

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	conversationroutes "github.com/atmaxmoj/standmeet/internal/routes/conversation"
	inferenceroutes "github.com/atmaxmoj/standmeet/internal/routes/inference"
	reportroutes "github.com/atmaxmoj/standmeet/internal/routes/report"
)

const socketDirMode = 0o700

// wireSummarizeGateway —— summarize.sock 上挂 conversation.read + inference.generate + report.store。
func wireSummarizeGateway(
	ctx context.Context, d *runtimeDeps, skills *conversation.VisitorSkillsDeps,
) {
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("summarize socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/summarize.sock", d.log)
	if err != nil {
		d.log.Error("summarize socket listen", "err", err)
		return
	}
	conversationroutes.RegisterConversationReadOp(srv, d.chatRepo)
	inferenceroutes.RegisterInferenceGenerateOp(srv, skills.Resolver)
	reportroutes.RegisterReportStoreOp(srv, skills.Reports)
	go srv.Serve(ctx)
}

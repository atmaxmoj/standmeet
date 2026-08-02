// hostdesk.go —— 按各能力**声明**的 host op 开它们的 socket。
//
// 这里替代了原来四个手写网关(retrieval / summarize / mail-sender / booker):它们各自
// 站一个 socket、各自往上挂动词,于是"沙箱能问宿主要什么"这个问题只能靠读那四个文件回答。
// 现在词表在 internal/routes/hostdesk,能力在自己的 manifest 里按名字点单,这里照着发。
//
// 点了词表里没有的名字 → **启动就炸**。一个 manifest 声称自己要某件事而宿主根本不提供,
// 那是一句谎话,不该等到访客点下去才发现。

package wire

import (
	"context"
	"os"

	"github.com/atmaxmoj/standmeet/cmd/server/axiscap"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

const socketDirMode = 0o700

// HostDesk —— 遍历内建 manifest,给每个声明了 HostOps 的能力开一个 socket。
func HostDesk(
	ctx context.Context, d *deps.Runtime, skills *conversation.VisitorSkillsDeps,
) {
	if mkErr := os.MkdirAll(hostdesk.SocketDir, socketDirMode); mkErr != nil {
		d.Log.Error("host socket dir", "err", mkErr)
		return
	}
	shared := sharedHostDeps(d, skills)
	manifests := axiscap.BuiltinManifests()
	for i := range manifests {
		serveHostOps(ctx, d, shared, &manifests[i])
	}
}

// serveHostOps —— 一个能力:装它自己的隔离存储和配置,取它点名的那些 op,开 socket。
func serveHostOps(
	ctx context.Context, d *deps.Runtime, shared *hostdesk.Deps, m *mcpplugin.Manifest,
) {
	want := axiscap.HostOpsOf(m)
	if len(want) == 0 {
		return // 不要后端数据的插件:完全断网,连 socket 都没有。
	}
	per := axiscap.PerCapabilityDeps(d, m)
	srv, serr := hostdesk.Serve(ctx, d.Log, m.ID, want, hostdesk.Collect(shared, per))
	if serr != nil {
		// 声明了宿主不提供的 op = manifest 在说谎,启动期就该炸。
		panic(serr)
	}
	_ = srv
}

// sharedHostDeps —— 跟能力无关的那几样(语料、对话、owner、连接器)。
//
// 语料的三个 lister 和 LLM 解析器取自访客技能那份 deps:同一份对象,访客工具和沙箱能力
// 读到的是同一套 ACL 与同一个凭据解析路径。
func sharedHostDeps(
	d *deps.Runtime, skills *conversation.VisitorSkillsDeps,
) *hostdesk.Deps {
	return &hostdesk.Deps{
		Conversation: conversation.OpsHost{
			Chats: d.ChatRepo, Resolver: skills.Resolver, Reports: skills.Reports,
		},
		Corpus: &corpus.IndexDeps{
			Wiki: skills.Wiki, Output: skills.Output, Writings: skills.Writings,
			Subjectivity: d.SubjectivityRepo, VaultSync: d.VaultSyncRepo,
			NoteRefs: d.NoteRefRepo, Searcher: d.SearchClient,
		},
		Owners:     d.OwnerRepo,
		Connectors: d.ConnectorSlots,
	}
}

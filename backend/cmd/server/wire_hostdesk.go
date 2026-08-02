// wire_hostdesk.go —— 按各能力**声明**的 host op 开它们的 socket。
//
// 这里替代了原来四个手写网关(retrieval / summarize / mail-sender / booker):它们各自
// 站一个 socket、各自往上挂动词,于是"沙箱能问宿主要什么"这个问题只能靠读那四个文件回答。
// 现在词表在 internal/routes/hostdesk,能力在自己的 manifest 里按名字点单,这里照着发。
//
// 点了词表里没有的名字 → **启动就炸**。一个 manifest 声称自己要某件事而宿主根本不提供,
// 那是一句谎话,不该等到访客点下去才发现。

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

const socketDirMode = 0o700

// wireHostDesk —— 遍历内建 manifest,给每个声明了 HostOps 的能力开一个 socket。
func wireHostDesk(
	ctx context.Context, d *runtimeDeps, skills *conversation.VisitorSkillsDeps,
) {
	if mkErr := os.MkdirAll(hostdesk.SocketDir, socketDirMode); mkErr != nil {
		d.log.Error("host socket dir", "err", mkErr)
		return
	}
	shared := sharedHostDeps(d, skills)
	manifests := builtinManifests()
	for i := range manifests {
		serveHostOps(ctx, d, shared, &manifests[i])
	}
}

// serveHostOps —— 一个能力:装它自己的隔离存储和配置,取它点名的那些 op,开 socket。
func serveHostOps(
	ctx context.Context, d *runtimeDeps, shared *hostdesk.Deps, m *mcpplugin.Manifest,
) {
	want := hostOpsOf(m)
	if len(want) == 0 {
		return // 不要后端数据的插件:完全断网,连 socket 都没有。
	}
	per, err := perCapabilityDeps(ctx, d, m)
	if err != nil {
		d.log.Error("capability storage provision", "cap", m.ID, "err", err)
		return
	}
	srv, serr := hostdesk.Serve(ctx, d.log, m.ID, want, hostdesk.Collect(shared, per))
	if serr != nil {
		// 声明了宿主不提供的 op = manifest 在说谎,启动期就该炸。
		panic(serr)
	}
	_ = srv
}

func hostOpsOf(m *mcpplugin.Manifest) []string {
	if m.Transport.Sandbox == nil {
		return []string{}
	}
	return m.Transport.Sandbox.HostOps
}

// sharedHostDeps —— 跟能力无关的那几样(语料、对话、owner、连接器)。
//
// 语料的三个 lister 和 LLM 解析器取自访客技能那份 deps:同一份对象,访客工具和沙箱能力
// 读到的是同一套 ACL 与同一个凭据解析路径。
func sharedHostDeps(
	d *runtimeDeps, skills *conversation.VisitorSkillsDeps,
) *hostdesk.Deps {
	return &hostdesk.Deps{
		Conversation: conversation.OpsHost{
			Chats: d.chatRepo, Resolver: skills.Resolver, Reports: skills.Reports,
		},
		Corpus: &corpus.IndexDeps{
			Wiki: skills.Wiki, Output: skills.Output, Writings: skills.Writings,
			Subjectivity: d.subjectivityRepo, VaultSync: d.vaultSyncRepo,
			NoteRefs: d.noteRefRepo, Searcher: d.searchClient,
		},
		Owners:     d.ownerRepo,
		Connectors: d.connectorSlots,
	}
}

// perCapabilityDeps —— 一个能力**自己的**存储和配置。
//
// 存储在构造期就绑死到这个能力的命名空间(schema = mcp_<id>),沙箱那侧填不了别人的表。
// 声明了 capstore.* 的能力才 provision —— 没声明就没有 schema,不是"有但空着"。
func perCapabilityDeps(
	ctx context.Context, d *runtimeDeps, m *mcpplugin.Manifest,
) (*hostdesk.PerCapability, error) {
	per := &hostdesk.PerCapability{}
	if !wantsAny(m, "capstore.") && len(m.Config) == 0 {
		return per, nil
	}
	store := capstore.New(d.db)
	if err := store.Provision(ctx, capstore.KindMCP, m.ID); err != nil {
		return nil, fmt.Errorf("capability %q storage: %w", m.ID, err)
	}
	per.Store = boundCapStore{store: store, kind: capstore.KindMCP, id: m.ID}
	if len(m.Config) > 0 {
		per.Config = boundCapConfig{
			cfg:  capConfigFor(store, m.ID),
			decl: m.Config,
		}
	}
	return per, nil
}

// wantsAny —— 这个能力点过某个前缀下的 op 没有。
func wantsAny(m *mcpplugin.Manifest, prefix string) bool {
	for _, name := range hostOpsOf(m) {
		if len(name) >= len(prefix) && name[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}

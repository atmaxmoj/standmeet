// Package hostdesk —— 入站收口:沙箱里的能力回头问宿主要东西,只能从这儿要。
//
// 它是出站收口(internal/routes/dispatcher)的镜像:
//
//	出站  域声明 Op    → facade 再导出 → dispatcher.Collect → 各个面投影
//	入站  域声明 HostOp → facade 再导出 → hostdesk.Collect   → 各能力的 socket 投影
//
// 为什么要有这么个地方:能力断了网,只有一根 unix socket 通向宿主。在这之前,**每个能力
// 自己站一个 socket、自己往上挂动词**,于是"沙箱能问宿主要什么"这个问题没有答案 ——
// 要读四个手写的接线函数才拼得出来,而且谁都能再挂一个新动词。
//
// 现在这份清单就是那个答案。能力在自己的 manifest 里按名字点单(Transport.Sandbox.HostOps),
// 宿主按声明发;点了这儿没有的名字 → **启动就炸**,不会等到 owner 点下去才发现。
//
// 收口自己不实现任何东西:它 import 各域的正门和两根轴自己的机制,把声明汇起来。
package hostdesk

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	capconfigroutes "github.com/atmaxmoj/standmeet/internal/routes/capconfig"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
	connectorroutes "github.com/atmaxmoj/standmeet/internal/routes/connector"
)

// SocketDir —— 每个能力的 socket 落在这儿(路径规则在 hostop,装载器照同一条算)。
const SocketDir = hostop.SocketDir

// Deps —— 各域声明 host op 时要的依赖包,由组装根填。
//
// PerCapability 那两样(自己的存储、自己的配置)在**每个能力**上都不一样(构造期就绑死到
// 它的命名空间),所以不在这儿,由 Collect 的调用方按能力给。
type Deps struct {
	Conversation conversation.OpsHost
	Corpus       *corpus.IndexDeps
	Owners       owner.OpsHostLookup
	Connectors   connectorroutes.Invoker
}

// PerCapability —— 只属于某一个能力的那两样:它自己的隔离存储、它自己声明的配置。
//
// 它们必须按能力构造 —— 一个能力拿到的 store 已经绑死在自己的命名空间上,所以它填不了
// 别人的表。这不是每次请求校验出来的隔离,是构造出来的。
type PerCapability struct {
	Store  capstoreroutes.BoundStore
	Config capconfigroutes.BoundConfig
}

// Collect —— 宿主开给沙箱的全部 host op。一个来源一行,收口只汇聚。
//
// 某个来源这次给不出东西(这个能力没要存储、没声明配置)由**它自己**返空;收口不替各个
// 来源记条件 —— 一旦它开始记,再加一个来源就得改这里,而那正是收口该消掉的东西。
func Collect(d *Deps, per *PerCapability) []hostop.Op {
	if per == nil {
		per = &PerCapability{}
	}
	ops := conversation.HostOps(d.Conversation)
	ops = append(ops, corpus.CorpusHostOpsFor(d.Corpus)...)
	ops = append(ops, owner.HostOps(d.Owners)...)
	ops = append(ops, connectorroutes.Ops(d.Connectors)...)
	ops = append(ops, capstoreroutes.Ops(per.Store)...)
	ops = append(ops, capconfigroutes.Ops(per.Config)...)
	return ops
}

// Serve —— 给一个能力开它**点过名**的那些 op,socket 路径由 id 派生。
//
// 点了收口没有的名字 → 错误(组装根据此在启动时炸)。少给一个名字的后果是那件事它调不到,
// 而不是它偷偷能调 —— 默认是关的。
func Serve(
	ctx context.Context, log *slog.Logger, pluginID string, want []string, all []hostop.Op,
) (*capsocket.Server, error) {
	return ServeAt(ctx, log, &ServeInput{
		PluginID: pluginID, Want: want, All: all, SockPath: SocketPath(pluginID),
	})
}

// ServeAt —— 同上,但 socket 路径由调用方给。
//
// 为 eval 的 mini-host 开的:那边跑在 macOS 上,没有 /run,而**挑哪几件 op** 那一步必须还是
// 这一份 —— 词汇表和"点了没有的名字就报错"这条,不能因为换了个路径就变成第二套。
func ServeAt(ctx context.Context, log *slog.Logger, in *ServeInput) (*capsocket.Server, error) {
	handlers, err := pick(in.PluginID, in.Want, in.All)
	if err != nil {
		return nil, err
	}
	srv, lerr := capsocket.ListenWith(ctx, in.SockPath, handlers, log)
	if lerr != nil {
		return nil, fmt.Errorf("hostdesk: %w", lerr)
	}
	go srv.Serve(ctx)
	return srv, nil
}

// ServeInput —— ServeAt 的入参:给谁开、开哪几件、词表是什么、socket 落在哪。
type ServeInput struct {
	PluginID string
	SockPath string
	Want     []string
	All      []hostop.Op
}

// SocketPath —— 一个能力的 socket 落在哪儿。宿主派生,manifest 不写。
func SocketPath(pluginID string) string {
	return hostop.SocketPath(pluginID)
}

func pick(
	pluginID string, want []string, all []hostop.Op,
) (map[string]capsocket.Handler, error) {
	byName := byOpName(all)
	out := make(map[string]capsocket.Handler, len(want))
	for _, name := range want {
		invoke, ok := byName[name]
		if !ok {
			return nil, fmt.Errorf(
				"hostdesk: capability %q asks for host op %q, which the host does not publish",
				pluginID, name)
		}
		out[name] = capsocket.Handler(invoke)
	}
	return out, nil
}

// byOpName —— 词表按名字索引一次。
func byOpName(all []hostop.Op) map[string]hostop.Invoke {
	byName := make(map[string]hostop.Invoke, len(all))
	for i := range all {
		byName[all[i].Name] = all[i].Invoke
	}
	return byName
}

// booker_host.go —— eval mini-host 给沙箱能力开的那根 socket:**只做适配,不带任何替身**。
//
// booker 这类能力断了网,只有一根 unix socket 通向宿主,上面挂着它 manifest 里点名的那几件
// host op。prod 那一份由入站收口(routes/hostdesk)按各域的声明发;这里发的是**同一份声明**
// (同一个 Collect、同一个 pick),只是背后接的是调用方给的实现。
//
// 那些实现(一份会回答的日历、一张内存记录表)住在 eval-harness 那一侧 —— P.13 的不变量:
// backend 里一个替身都不留。这个文件因此只有桥:把公开的、纯数据的口(ConnectorCall /
// CapabilityStore)接到内部那几个端口上。
//
// 为什么不让 harness 自己写 9 个 handler:那样词汇表就有了第二个来源,manifest 改一个名字
// eval 照样绿 —— 而它测的已经是产品里不存在的那套接口了。这里换的是后端,不是词表。

package agentcore

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

// ConnectorCall —— 一次外部调用:"<category>.<verb>"(如 "calendar.free_busy")+ 入参 JSON,
// 返回响应 JSON 或错。**调用方实现** —— 宿主这一层不知道日历长什么样。
type ConnectorCall func(call string, args []byte) ([]byte, error)

// StoredRecord —— 能力自己存储里的一条:id + 文档。
type StoredRecord struct {
	ID  string
	Doc []byte
}

// CapabilityStore —— 一个能力自己的隔离存储(调用方实现)。
//
// 过滤器是一段 JSON,语义照 prod 那份:**包含**(postgres 的 doc @> filter)。语义不同的话,
// 一个按 code_id 数用量的配额闸在这一侧会数出别的数 —— 而那种偏差不会报错。
type CapabilityStore interface {
	Insert(collection string, doc []byte) (string, error)
	Query(collection string, filter []byte) ([]StoredRecord, error)
	DeleteByID(collection, recordID string) (bool, error)
	DeleteMatching(collection string, filter []byte) (int, error)
}

// CapabilityHost —— 挂一个能力所需要的东西。字段全是数据或函数,所以独立 module 填得出来。
type CapabilityHost struct {
	// Connector —— 外部世界。nil = 这个能力不点 connector.invoke。
	Connector ConnectorCall
	// Store —— 它自己的存储。nil = 它不点 capstore.*。
	Store CapabilityStore
	// Config —— 覆盖某几项配置(键 → 原始 JSON)。没给的项走 manifest 声明的默认值 ——
	// "默认值只有一处"在这一侧同样成立。
	Config map[string]string
	// OwnerID / Timezone —— owner.meta 回答的那两项。Timezone 必须跟这一轮 instruction 里
	// 说的那个时区一致:预约策略按 owner 的时区判,两处不一致会让一个开着的时段显示成关的。
	OwnerID  string
	Timezone string

	manifest mcpplugin.Manifest
}

// StartCapabilitySocket —— 按 manifest 点的那些 host op 起一个 socket。
//
// 点了词表里没有的名字 → 报错,跟 prod 启动时炸是同一个信号。
func StartCapabilitySocket(
	ctx context.Context, h *CapabilityHost, capID, sockPath string,
) (func() error, error) {
	m, err := BuiltinManifest(capID)
	if err != nil {
		return nil, err
	}
	h.manifest = m
	want := []string{}
	if m.Transport.Sandbox != nil {
		want = m.Transport.Sandbox.HostOps
	}
	srv, serr := hostdesk.ServeAt(ctx, slog.Default(), &hostdesk.ServeInput{
		PluginID: capID, Want: want, SockPath: sockPath,
		All: hostdesk.Collect(h.deps(), h.perCapability()),
	})
	if serr != nil {
		return nil, fmt.Errorf("capability socket: %w", serr)
	}
	return srv.Close, nil
}

// deps —— 域依赖。Conversation / Corpus 这一侧给空:booker 没点它们的 op,而 pick 只发
// 点过的名字 —— 没点的那些连处理器都不会挂上去。
func (h *CapabilityHost) deps() *hostdesk.Deps {
	return &hostdesk.Deps{
		Corpus:     &corpus.IndexDeps{},
		Owners:     ownerMetaBridge{tz: h.Timezone},
		Connectors: connectorBridge{call: h.Connector},
	}
}

// perCapability —— 只属于这个能力的两样:它自己的存储、它自己的配置。
func (h *CapabilityHost) perCapability() *hostdesk.PerCapability {
	return &hostdesk.PerCapability{
		Store:  storeBridge{store: h.Store},
		Config: manifestConfigBridge{host: h},
	}
}

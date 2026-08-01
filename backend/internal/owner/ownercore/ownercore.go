// Package ownercore —— **正在解散**。这里曾经装着全部 owner-MCP 能力(#135 把它们从
// mcphandle 搬进这个进程内插件),现在它们一个个回到了自己的域:域声明 op,收口汇聚,
// MCP 面是收口的投影。
//
// 只剩 writings 的**写**(writing_create)。它没走,是因为面板那条是 multipart(正文里的
// 内联图片跟表单一起传)、MCP 这条是一串 URL 让服务端去取 —— 字节流进不了一个 JSON op。
// 要并成一份,得先把"上传素材"拆成独立一步。那笔债还清,这个包就整包删除。
package ownercore

import (
	"log/slog"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// Name —— plugin registry identity.
const Name = "ownercore"

// Deps —— 只剩 writings 的写要的那些。
type Deps struct {
	Writings   *corpus.WritingsDeps
	WritingsTx *corpus.WritingsTxDeps
	Log        *slog.Logger
}

// Plugin —— implements capabilities.Plugin + capabilities.CapabilityRegistrar.
type Plugin struct {
	deps *Deps
}

var (
	_ capabilities.Plugin              = (*Plugin)(nil)
	_ capabilities.CapabilityRegistrar = (*Plugin)(nil)
)

// New 构造 owner-core 插件。
func New(deps *Deps) *Plugin { return &Plugin{deps: deps} }

// Name —— capabilities.Plugin.
func (*Plugin) Name() string { return Name }

// RegisterCapabilities —— 只注册还没搬走的那一个。
//
// 已经走了:ip_bans → security、api_keys → access、connectors → 连接器轴、
// corpus 四件 → corpus 域(genre 收成参数)、seo / page / custom_page / chat / account
// 等等 → 各自的域。它们现在都经出站收口投影到 MCP 面。
func (p *Plugin) RegisterCapabilities(reg *capreg.Registry) {
	reg.MustRegister(newWritingsCapability(p.deps.WritingsTx, p.deps.Writings, p.deps.Log))
}

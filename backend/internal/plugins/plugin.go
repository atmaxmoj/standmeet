// Package plugins —— J phase: outbound plugin pattern。
//
// StandMeet 核心 = corpus + visitor chat + AccessCode + PDF render + AI provider。
// 各 outbound use case (jobs / pitch / talent / 等) 走 "plugin" 模式：每个
// 自己持 schema / MCP tools / admin routes / capability，core 不知道它存在。
// 加新 outbound 只往 plugins/ 添子目录，不动 core。
//
// J.1 锁 Name 接口。J.5 起加 lifecycle hook (CapabilityRegistrar / AdminRouter)
// 让 plugin 自己接管 MCP capability + admin REST 挂载；core wireup 只调
// `reg.RegisterAllCapabilities(skills)` + `reg.MountAllAdminRoutes(r)`，不
// 再 case-by-case if-jobs-then-... 散在 composition root。
//
// 接口 deliberately split：每个 hook 是 optional (Plugin 不强制实现)，让
// plugin 按自己实际能力挂哪些面 (只挂 MCP 不挂 admin 等)。
package plugins

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capreg"
)

// Plugin —— 一个 outbound use case 的最小标识。具体能力 (MCP tools / admin
// routes / migrations / agent capabilities / AccessCode hooks) 由各自 optional
// sub-interface 暴露 (CapabilityRegistrar / AdminRouter / ...)；wireup 用
// type-assert 拿到具体 hook 调即可。
type Plugin interface {
	Name() string
}

// CapabilityRegistrar —— optional hook: plugin 把自己的 owner-MCP capabilities
// 注册到核心 capreg.Registry。重 ID 由 capreg 自身 panic 兜底。
type CapabilityRegistrar interface {
	RegisterCapabilities(reg *capreg.Registry)
}

// AdminRouter —— optional hook: plugin 把自己的 owner admin REST routes 挂
// 到入参 router (caller 负责事先用 WithOwner / RequireCSRF middleware 包好)。
type AdminRouter interface {
	MountAdminRoutes(r chi.Router)
}

// Registry —— 启动期注册全部启用 plugins。boot 跑一次 Register*，wireup
// 时调 RegisterAllCapabilities / MountAllAdminRoutes 把全部 plugin 的 hook
// 一次性执行完毕。
type Registry struct {
	plugins []Plugin
}

// NewRegistry —— 构造空 registry。
func NewRegistry() *Registry {
	return &Registry{plugins: []Plugin{}}
}

// Register —— 把 plugin 加进 registry。重复 Name 不 panic (caller 自己
// 保 plugin 单例)；Plugins() 返回顺序 = 注册顺序。
func (r *Registry) Register(p Plugin) {
	r.plugins = append(r.plugins, p)
}

// Plugins —— 拷贝一份返回 (slice 内容不可被外部 mutate)。
func (r *Registry) Plugins() []Plugin {
	out := make([]Plugin, len(r.plugins))
	copy(out, r.plugins)
	return out
}

// Names —— 注册顺序返每个 plugin 的 Name；admin debug + log 用。
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.plugins))
	for _, p := range r.plugins {
		out = append(out, p.Name())
	}
	return out
}

// RegisterAllCapabilities —— 遍历每个 plugin，实现了 CapabilityRegistrar
// 就调一次 RegisterCapabilities。注册顺序 = plugin 注册顺序。
func (r *Registry) RegisterAllCapabilities(skills *capreg.Registry) {
	for _, p := range r.plugins {
		if cr, ok := p.(CapabilityRegistrar); ok {
			cr.RegisterCapabilities(skills)
		}
	}
}

// MountAllAdminRoutes —— 遍历每个 plugin，实现了 AdminRouter 就调一次
// MountAdminRoutes。挂载顺序 = plugin 注册顺序。
func (r *Registry) MountAllAdminRoutes(router chi.Router) {
	for _, p := range r.plugins {
		if ar, ok := p.(AdminRouter); ok {
			ar.MountAdminRoutes(router)
		}
	}
}

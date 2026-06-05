// Package plugins —— J phase: outbound plugin pattern。
//
// StandMeet 核心 = corpus + visitor chat + AccessCode + PDF render + AI provider。
// 各 outbound use case (jobs / pitch / talent / 等) 走 "plugin" 模式：每个
// 自己持 schema / MCP tools / admin routes / capability，core 不知道它存在。
// 加新 outbound 只往 plugins/ 添子目录，不动 core。
//
// J.1 scaffold：interface 只锁 Name() —— 各 plugin 装 wireup 时 caller 拿到
// 具体类型再调具体方法 (RegisterMCP / MountAdmin / ...) 完成接管。后续 slice
// 再扩 interface 收口更多 lifecycle hook。
//
// 这一 package 没有具体 plugin，只有抽象 + registry；plugins/jobs/ etc 持
// 具体实现。
package plugins

// Plugin —— 一个 outbound use case 的最小标识。具体能力 (MCP tools / admin
// routes / migrations / agent capabilities / AccessCode hooks) 由具体 plugin
// 类型自己暴露；wireup 持具体类型 + 调具体方法即可。
//
// 为什么不一开始就锁全套 lifecycle interface？因为 plugin 跟 core 的边界
// 还在演化 (J.2-J.4 会陆续把 jobs 的 wireup 迁过来)，过早接口化会 lock
// 在错误的形状。J.1 先建空骨架 + 命名空间，让 jobs 的搬迁有归宿即可。
type Plugin interface {
	Name() string
}

// Registry —— 启动期注册全部启用 plugins。boot 跑一次 Register*，wireup
// 时迭代 Plugins() 拿全部 plugin 调具体方法。
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

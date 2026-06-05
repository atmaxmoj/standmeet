// Package jobs —— J phase: outbound "job-hunting" plugin。
//
// 实现的是 [[job-loop-2026-05]] 那条闭环 (jobs.fetch_new → resume.draft →
// applications.commit → AccessCode QR → recruiter scan → visitor chat)。
// J.1 scaffold 阶段：plugin 是空壳，sub-packages (fetch / cache) 已搬进来；
// 真正的 wireup 接管 (usecases / MCP tools / admin routes 走 plugin 边界)
// 留给 J.2-J.4。
//
// Sub-packages:
//   - fetch  —— per-ATS adapter (Greenhouse / Lever / Ashby / RemoteOK / ...)
//   - cache  —— Redis 1d TTL 池子，job source 抓的 FetchedJob 暂存
//   - (J.4) dedup  —— 多源去重 (JBA + 自维护 ATS direct)
package jobs

import "github.com/atmaxmoj/standmeet/internal/plugins"

// Name —— Plugin.Name 实现。固定 "jobs"。
const Name = "jobs"

// Plugin —— jobs outbound plugin 入口。J.1 是空壳，后续 slice 往这里挂
// MCP tools / admin routes / migrations / capability。
type Plugin struct{}

// New —— DI 构造；composition root 一次性持。
func New() *Plugin { return &Plugin{} }

// 静态保证 *Plugin 实现 plugins.Plugin。
var _ plugins.Plugin = (*Plugin)(nil)

// Name —— 跟 plugin registry 一致。
func (*Plugin) Name() string { return Name }

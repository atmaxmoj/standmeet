// Package jobs —— J phase: outbound "job-hunting" plugin。
//
// 实现的是 [[job-loop-2026-05]] 那条闭环 (jobs.fetch_new → resume.draft →
// applications.commit → AccessCode QR → recruiter scan → visitor chat)。
// J.5 起 plugin 接管全套 wireup：构造时拿 deps 闭包，启动通过 plugins
// hook 注册 MCP capabilities + 挂 admin REST。
//
// Sub-packages:
//   - fetch     —— per-ATS adapter (Greenhouse / Lever / Ashby / RemoteOK / ...)
//   - cache     —— Redis 1d TTL 池子，job source 抓的 FetchedJob 暂存
//   - jobsuc    —— usecases (jobs / resume / applications) 编排 + 接口
//   - jobsmcp   —— owner MCP capabilities (6 jobs + 3 resume + 1 applications)
//   - jobsadmin —— owner admin REST routes (drafts / applications list)
package jobs

import (
	"log/slog"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/plugins"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsadmin"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmcp"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// Name —— Plugin.Name 实现。固定 "jobs"。
const Name = "jobs"

// Deps —— 构造 jobs plugin 需要的全部依赖。composition root 一次性提供，
// plugin 闭包持引用让 RegisterCapabilities / MountAdminRoutes 不再额外传参。
type Deps struct {
	Jobs         *jobsuc.JobsDeps
	Resume       *jobsuc.ResumeDeps
	Applications *jobsuc.ApplicationsDeps
	DraftsRepo   *postgres.ResumeDraftRepo
	AppsRepo     *postgres.ApplicationRepo
	SourcesRepo  *postgres.JobSourceRepo
	Log          *slog.Logger
}

// Plugin —— jobs outbound plugin 入口。J.5 起持 Deps 闭包；
// 实现 plugins.Plugin + plugins.CapabilityRegistrar + plugins.AdminRouter。
type Plugin struct {
	deps Deps
}

// New —— DI 构造；composition root 一次性持。
func New(deps Deps) *Plugin { return &Plugin{deps: deps} }

// 静态保证三个 interface 全部实现。
var (
	_ plugins.Plugin              = (*Plugin)(nil)
	_ plugins.CapabilityRegistrar = (*Plugin)(nil)
	_ plugins.AdminRouter         = (*Plugin)(nil)
)

// Name —— 跟 plugin registry 一致。
func (*Plugin) Name() string { return Name }

// RegisterCapabilities —— plugins.CapabilityRegistrar 实现：注册 6+3+1 个
// owner-MCP tool 进核心 capreg.Registry。重 ID 由 capreg MustRegister
// 兜底 panic (boot 期失败比运行时漏注册好)。
func (p *Plugin) RegisterCapabilities(reg *capreg.Registry) {
	reg.MustRegister(jobsmcp.NewJobsCapability(p.deps.Jobs, p.deps.Log))
	reg.MustRegister(jobsmcp.NewResumeCapability(p.deps.Resume, p.deps.Log))
	reg.MustRegister(jobsmcp.NewApplicationsCapability(p.deps.Applications, p.deps.Log))
}

// MountAdminRoutes —— plugins.AdminRouter 实现：挂 /api/admin/drafts +
// /api/admin/applications 到入参 router。caller 负责事先用 WithOwner +
// RequireCSRF middleware 包好 (admin 共享认证栈)。
func (p *Plugin) MountAdminRoutes(r chi.Router) {
	jobsadmin.Mount(r, jobsadmin.Deps{
		Apps: p.deps.AppsRepo, Drafts: p.deps.DraftsRepo,
		Sources: p.deps.SourcesRepo, Pool: p.deps.Jobs.Cache, Log: p.deps.Log,
	})
}

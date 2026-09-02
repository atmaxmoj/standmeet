// Package jobs — J phase: the outbound "job-hunting" plugin.
//
// Implements the [[job-loop-2026-05]] closed loop (jobs.fetch_new →
// resume.draft → applications.commit → AccessCode QR → recruiter scan →
// visitor chat). Starting at J.5 the plugin owns the full wireup: it captures
// a deps closure at construction, and registers MCP capabilities + mounts
// admin REST at startup through the plugins hook.
//
// Sub-packages:
//   - fetch     — per-ATS adapter (Greenhouse / Lever / Ashby / RemoteOK / ...)
//   - cache     — Redis 1d TTL pool where FetchedJobs scraped from a job source sit
//   - jobsuc    — usecases (jobs / resume / applications) orchestration + interfaces
//   - jobsmcp   — owner MCP capabilities (6 jobs + 3 resume + 1 applications)
//   - jobsadmin — owner admin REST routes (drafts / applications list)
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsadmin"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmcp"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// Name — Plugin.Name implementation. Fixed to "jobs".
const Name = "jobs"

// Deps — the complete set of dependencies needed to construct the jobs
// plugin. The composition root provides it once; the plugin closes over the
// reference so RegisterCapabilities / MountAdminRoutes need no extra params.
type Deps struct {
	Jobs         *jobsuc.JobsDeps
	Resume       *jobsuc.ResumeDeps
	Applications *jobsuc.ApplicationsDeps
	DraftsRepo   *jobsuc.ResumeDraftRepo
	AppsRepo     *jobsuc.ApplicationRepo
	SourcesRepo  *jobsuc.JobSourceRepo
	// Seed — the repositories needed to seed the two builtins (hiring prompt +
	// role) this plugin owns. It belongs to the plugin, not the kernel's
	// roles_seed: `hiring` is a job-loop concept, not a kernel-level access
	// tier (see the header comment in jobsuc/seed.go).
	Seed jobsuc.SeedDeps
	Log  *slog.Logger
}

// Plugin — entry point for the jobs outbound plugin. Since J.5 it holds a
// Deps closure; implements capabilities.Plugin + capabilities.CapabilityRegistrar
// + capabilities.AdminRouter.
type Plugin struct {
	deps Deps
}

// New — DI constructor; the composition root holds it once.
func New(deps Deps) *Plugin { return &Plugin{deps: deps} }

// Static assertions that all four interfaces are implemented.
var (
	_ capabilities.Plugin              = (*Plugin)(nil)
	_ capabilities.CapabilityRegistrar = (*Plugin)(nil)
	_ capabilities.AdminRouter         = (*Plugin)(nil)
	_ capabilities.PeriodicWorker      = (*Plugin)(nil)
	_ capabilities.OwnerSeeder         = (*Plugin)(nil)
)

// resumeDraftSweepEvery — drafts have a 1d TTL. The read path already
// SQL-filters out expired rows (correctness doesn't depend on this sweep);
// the sweep just keeps expired rows from piling up in the table, so once an
// hour is enough.
const resumeDraftSweepEvery = time.Hour

// PeriodicJobs — capabilities.PeriodicWorker implementation: this plugin's
// periodic tasks.
//
// This used to live in the composition root's resume_draft_sweep.go — a
// ticker, a Register/Report bookkeeping block, a hand-written "every 1h".
// The plugin's own business logic landed in the wiring code only because
// there was no "plugin declares periodic jobs" mechanism at the time. Now
// it's back home; the loop and bookkeeping belong to the host.
func (p *Plugin) PeriodicJobs() []periodic.Job {
	return []periodic.Job{periodic.Named(
		"resume-draft sweep", resumeDraftSweepEvery,
		func(ctx context.Context) error {
			if err := p.deps.DraftsRepo.SweepExpired(ctx); err != nil {
				return fmt.Errorf("resume-draft sweep: %w", err)
			}
			return nil
		},
	)}
}

// Name — matches the plugin registry.
func (*Plugin) Name() string { return Name }

// RegisterCapabilities — capabilities.CapabilityRegistrar implementation:
// registers 6+3+1 owner-MCP tools into the core capreg.Registry. A duplicate
// ID panics via capreg's MustRegister as a backstop (failing at boot is
// better than a missing registration at runtime).
func (p *Plugin) RegisterCapabilities(reg *capreg.Registry) {
	reg.MustRegister(jobsmcp.NewJobsCapability(p.deps.Jobs, p.deps.Log))
	reg.MustRegister(jobsmcp.NewResumeCapability(p.deps.Resume, p.deps.Log))
	reg.MustRegister(jobsmcp.NewApplicationsCapability(p.deps.Applications, p.deps.Log))
}

// MountAdminRoutes — capabilities.AdminRouter implementation: mounts
// /api/admin/drafts + /api/admin/applications onto the given router. The
// caller is responsible for wrapping it beforehand with the WithOwner +
// RequireCSRF middleware (the shared admin auth stack).
func (p *Plugin) MountAdminRoutes(r chi.Router) {
	jobsadmin.Mount(r, jobsadmin.Deps{
		Apps: p.deps.AppsRepo, Drafts: p.deps.DraftsRepo,
		Sources: p.deps.SourcesRepo, Jobs: p.deps.Jobs, Log: p.deps.Log,
		// Commit — the panel's SEND button calls the **same** usecase, sharing
		// this deps with the applications.commit path (F-E-9). Assembling a
		// separate copy for admin would be a second source of truth.
		Commit: p.deps.Applications,
	})
}

// SeedOwner — capabilities.OwnerSeeder implementation. The shell only
// forwards: the domain work belongs to jobsuc; this package can't touch the
// domain facade under the arch rules.
func (p *Plugin) SeedOwner(ctx context.Context, ownerID string) error {
	if err := jobsuc.SeedOwner(ctx, p.deps.Seed, ownerID); err != nil {
		return fmt.Errorf("seed jobs builtins: %w", err)
	}
	return nil
}

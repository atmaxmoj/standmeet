// Package jobs — J phase: the outbound "job-hunting" plugin.
//
// Implements the [[job-loop-2026-05]] closed loop (jobs.fetch_new →
// resume.draft → applications.commit → AccessCode QR → recruiter scan →
// visitor chat). Starting at J.5 the plugin owns the full wireup: it captures
// a deps closure at construction, and registers MCP ops + mounts
// admin REST at startup through the plugins hook.
//
// Sub-packages:
//   - fetch     — per-ATS adapter (Greenhouse / Lever / Ashby / RemoteOK / ...)
//   - cache     — Redis 1d TTL pool where FetchedJobs scraped from a job source sit
//   - jobsuc    — usecases (jobs / resume / applications) orchestration + interfaces
//   - jobsmcp   — owner MCP ops (6 jobs + 3 resume + 1 applications)
//   - jobsadmin — owner admin REST routes (drafts / applications list)
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsadmin"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmcp"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// Name — Plugin.Name implementation. Fixed to "jobs".
const Name = "jobs"

// Deps — the complete set of dependencies needed to construct the jobs
// plugin. The composition root provides it once; the plugin closes over the
// reference so RegisterBlocks / MountAdminRoutes need no extra params.
type Deps struct {
	Jobs         *jobsuc.JobsDeps
	Resume       *jobsuc.ResumeDeps
	Applications *jobsuc.ApplicationsDeps
	DraftsRepo   *jobsuc.ResumeDraftRepo
	AppsRepo     *jobsuc.ApplicationRepo
	SourcesRepo  *jobsuc.JobSourceRepo
	Log          *slog.Logger
	// Seed — the repositories needed to seed the builtins (hiring prompt + role, plus the default
	// job aggregators) this plugin owns. It belongs to the plugin, not the kernel's roles_seed:
	// `hiring` is a job-loop concept, not a kernel-level access tier (see jobsuc/seed.go).
	Seed jobsuc.SeedDeps
	// Templates — Typst layout names the composer's picker offers. Threaded from the composition
	// root (resumepdf.Templates()); the plugin can't import resumepdf under the arch rules.
	Templates []string
}

// Plugin — entry point for the jobs module: owner tools, admin routes, periodic
// sweeps and first-run seeding for the outbound job loop.
//
// It used to satisfy five interfaces from a now-deleted package — Plugin,
// BlockRegistrar, AdminRouter, PeriodicWorker, OwnerSeeder — held in a registry
// the composition root walked. It was the only implementation any of them ever had.
// A registry with one member is a longer way to write a variable, and it made a star
// topology look like a plugin system; the root now holds this module and calls its
// methods by name. The methods are unchanged, so what the module DOES is unchanged.
type Plugin struct {
	deps *Deps
}

// New — DI constructor; the composition root holds it once. Takes a pointer: Deps is a wide
// closure of the module's dependencies, too heavy to pass by value (gocritic hugeParam).
func New(deps *Deps) *Plugin { return &Plugin{deps: deps} }

// resumeDraftSweepEvery — drafts have a 1d TTL. The read path already
// SQL-filters out expired rows (correctness doesn't depend on this sweep);
// the sweep just keeps expired rows from piling up in the table, so once an
// hour is enough.
const resumeDraftSweepEvery = time.Hour

// PeriodicJobs — the PeriodicWorker role: this plugin's
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

// RegisterBlocks — the BlockRegistrar role:
// registers 6+3+1 owner-MCP tools into the core registry.Registry. A duplicate
// ID panics via the registry's MustRegister as a backstop (failing at boot is
// better than a missing registration at runtime).
func (p *Plugin) RegisterBlocks(reg *registry.Registry) {
	reg.MustRegister(jobsmcp.NewJobsFiber(p.deps.Jobs, p.deps.Log))
	reg.MustRegister(jobsmcp.NewResumeFiber(p.deps.Resume, p.deps.Log))
	reg.MustRegister(jobsmcp.NewApplicationsFiber(p.deps.Applications, p.deps.Log))
}

// MountAdminRoutes — the AdminRouter role: mounts
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
		Commit:    p.deps.Applications,
		Templates: p.deps.Templates,
	})
}

// SeedOwner — the host's SeedPlugins hook implementation. The shell only
// forwards: the domain work belongs to jobsuc; this package can't touch the
// domain facade under the arch rules.
func (p *Plugin) SeedOwner(ctx context.Context, ownerID string) error {
	if err := jobsuc.SeedOwner(ctx, p.deps.Seed, ownerID); err != nil {
		return fmt.Errorf("seed jobs builtins: %w", err)
	}
	return nil
}

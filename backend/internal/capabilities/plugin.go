// plugin.go — the in-process loading mechanism for the capability axis (formerly the
// Plugin/Registry in internal/plugins, folded into capabilities per backend-domain-modules.md).
//
// Each in-process capability (owner-side caps / outbound use case) implements Plugin, and
// optionally hangs lifecycle hooks (CapabilityRegistrar / AdminRouter) off it; Register runs
// once at boot into the Registry, and wireup calls RegisterAllCapabilities /
// MountAllAdminRoutes exactly once instead of case-by-case code scattered in the composition
// root. Every hook is optional (type-assert): each plugin hangs whichever faces it needs.

package capabilities

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// Plugin — the minimal identity of one outbound use case. Concrete capabilities (MCP tools /
// admin routes / migrations / agent capabilities / AccessCode hooks) are each exposed by their
// own optional sub-interface (CapabilityRegistrar / AdminRouter / ...); wireup just
// type-asserts to get the concrete hook and calls it.
type Plugin interface {
	Name() string
}

// CapabilityRegistrar — optional hook: the plugin registers its own owner-MCP capabilities
// into the core capreg.Registry. A duplicate ID is caught by capreg's own panic guard.
type CapabilityRegistrar interface {
	RegisterCapabilities(reg *capreg.Registry)
}

// AdminRouter — optional hook: the plugin mounts its own owner admin REST routes onto the
// given router (the caller is responsible for wrapping it with WithOwner / RequireCSRF
// middleware beforehand).
type AdminRouter interface {
	MountAdminRoutes(r chi.Router)
}

// PeriodicWorker — optional hook: the plugin declares its own periodic jobs (things like
// sweeping expired rows).
//
// It only declares "what to do, how often"; when it starts and how it surfaces in the Monitor
// panel belongs to the one host-side scheduler (internal/infra/periodic). This hook didn't
// exist before, so the jobs plugin's resume-draft sweep ended up written into the composition
// root — a plugin's business logic landing wherever the wiring happened to sit, only because
// the ticker was there.
type PeriodicWorker interface {
	PeriodicJobs() []periodic.Job
}

// Registry — registers every enabled plugin at startup. Boot runs Register* once, and wireup
// calls RegisterAllCapabilities / MountAllAdminRoutes to run every plugin's hooks in one pass.
type Registry struct {
	plugins []Plugin
}

// NewRegistry — constructs an empty registry.
func NewRegistry() *Registry {
	return &Registry{plugins: []Plugin{}}
}

// Register — adds a plugin to the registry. A duplicate Name does not panic (the caller is
// responsible for keeping plugins singletons); Plugins() returns them in registration order.
func (r *Registry) Register(p Plugin) {
	r.plugins = append(r.plugins, p)
}

// Plugins — returns a copy (the slice's contents must not be mutated by callers).
func (r *Registry) Plugins() []Plugin {
	out := make([]Plugin, len(r.plugins))
	copy(out, r.plugins)
	return out
}

// Names — returns each plugin's Name in registration order; used by admin debug + logging.
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.plugins))
	for _, p := range r.plugins {
		out = append(out, p.Name())
	}
	return out
}

// RegisterAllCapabilities — walks every plugin and calls RegisterCapabilities once for each
// that implements CapabilityRegistrar. Order follows plugin registration order.
func (r *Registry) RegisterAllCapabilities(skills *capreg.Registry) {
	for _, p := range r.plugins {
		if cr, ok := p.(CapabilityRegistrar); ok {
			cr.RegisterCapabilities(skills)
		}
	}
}

// MountAllAdminRoutes — walks every plugin and calls MountAdminRoutes once for each that
// implements AdminRouter. Mount order follows plugin registration order.
func (r *Registry) MountAllAdminRoutes(router chi.Router) {
	for _, p := range r.plugins {
		if ar, ok := p.(AdminRouter); ok {
			ar.MountAdminRoutes(router)
		}
	}
}

// AllPeriodicJobs — collects every periodic job declared by any plugin, for the host's one
// scheduler to start.
func (r *Registry) AllPeriodicJobs() []periodic.Job {
	out := []periodic.Job{}
	for _, p := range r.plugins {
		if pw, ok := p.(PeriodicWorker); ok {
			out = append(out, pw.PeriodicJobs()...)
		}
	}
	return out
}

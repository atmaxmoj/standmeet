// workspaces.go — wiring for the per-session sandbox workspace subsystem (#148).
//
// Builds a sandboxws.Manager (root from SANDBOX_WORKSPACE_ROOT, defaulting to
// /srv/sandbox-workspaces), and injects its Provision into the usecases sandbox dial path
// (a plugin with manifest workspace=true lazily creates a workspace per conversation_id and
// binds it into /workspace). TTL is controllable at the backend (changed via the diag/admin
// endpoint). No root configured in env → skip (no workspace subsystem).
//
// Periodic sweeping of expired directories **doesn't live here**: that's sandboxws's own
// declaration (its own periodic.go); the assembly root just hands it to the scheduler
// alongside every other declaration.

package axiscap

import (
	"os"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

const (
	defaultWorkspaceRoot = "/srv/sandbox-workspaces"
	defaultWorkspaceTTL  = time.Hour
)

// SandboxWorkspaces — builds the per-session sandbox workspace subsystem and injects the
// provisioner.
func SandboxWorkspaces(d *deps.Runtime) {
	root := os.Getenv("SANDBOX_WORKSPACE_ROOT")
	if root == "" {
		root = defaultWorkspaceRoot
	}
	mgr, err := sandboxws.New(root, defaultWorkspaceTTL)
	if err != nil {
		// The workspace subsystem failing to start shouldn't take down boot: log it and
		// continue (sandbox plugins just get no /workspace).
		d.Log.Error("sandbox workspaces init", "root", root, "err", err)
		return
	}
	d.SandboxWorkspaces = mgr
	capload.SetWorkspaceProvisioner(mgr.Provision)
	// Sweeping is declared by mgr itself (sandboxws.PeriodicJobs); wirePeriodicJobs gathers
	// it up and schedules it.
}

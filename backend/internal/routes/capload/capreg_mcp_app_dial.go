// capreg_mcp_app_dial.go —— mcpAppCapability's transport-dialing sub-concern: dials a
// manifest's Transport (stdio / http / in_process / sandbox_stdio) into an mcpclient
// session. Split out of capreg_mcp_app.go to keep it under the max-lines 350 cap. Unified:
// all four kinds go through the same entry point, dialMCPApp, only the underlying
// implementation differs.

package capload

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// transportDialers —— one dialer per transport kind; dialMCPApp dispatches via this table.
// in_process connects in-memory directly to a same-process server; sandbox_stdio starts a
// third-party server isolated through bwrap. workspaceDir is this session's lazily
// provisioned per-session workspace (non-empty only for sandbox_stdio + manifest
// workspace=true); non-sandbox dialers ignore it.
//
// The dialer takes the whole manifest, not just Transport: the host socket path the sandbox
// needs to bind is derived from the **host-trusted id** (hostop.SocketPath), not read from a
// manifest field.
var transportDialers = map[string]func(
	context.Context, *mcpplugin.Manifest, string,
) (*mcpclient.Session, error){
	mcpplugin.TransportStdio:        dialStdio,
	mcpplugin.TransportHTTP:         dialHTTP,
	mcpplugin.TransportInProcess:    dialInProcess,
	mcpplugin.TransportSandboxStdio: dialSandboxStdio,
}

// dialMCPApp —— looks up transportDialers and dispatches. Unknown kind → error. The error
// is folded into ErrHidden by VisitorBinding; this function is only responsible for dialing.
func dialMCPApp(
	ctx context.Context, m *mcpplugin.Manifest, workspaceDir string,
) (*mcpclient.Session, error) {
	d, ok := transportDialers[m.Transport.Kind]
	if !ok {
		return nil, fmt.Errorf("plugin: unknown transport kind %q", m.Transport.Kind)
	}
	return d(ctx, m, workspaceDir)
}

func dialStdio(ctx context.Context, m *mcpplugin.Manifest, _ string) (*mcpclient.Session, error) {
	t := &m.Transport
	sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
	return sess, wrapDial(err)
}

func dialHTTP(ctx context.Context, m *mcpplugin.Manifest, _ string) (*mcpclient.Session, error) {
	t := &m.Transport
	sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
	return sess, wrapDial(err)
}

func dialInProcess(
	ctx context.Context, m *mcpplugin.Manifest, _ string,
) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialInProcess(ctx, m.Transport.InProcessServer)
	return sess, wrapDial(err)
}

// dialSandboxStdio —— the main process starts the third-party server inside a bubblewrap
// isolation environment (read-only host runtime + read-only plugin code + a per-session
// workspace + tmpfs /tmp + no network by default, unable to touch the host); stdio passes
// transparently through bwrap's stdin/stdout, so dialing is still a plain DialStdio, just
// with the command wrapped in `bwrap`. A non-empty workspaceDir gets bound into the
// sandbox's /workspace (writable, persists across turns).
func dialSandboxStdio(
	ctx context.Context, m *mcpplugin.Manifest, workspaceDir string,
) (*mcpclient.Session, error) {
	argv, aerr := sandboxStdioArgv(m, workspaceDir)
	if aerr != nil {
		return nil, wrapDial(aerr)
	}
	sess, derr := mcpclient.DialStdio(ctx, "bwrap", argv, m.Transport.Env)
	return sess, wrapDial(derr)
}

// sandboxStdioArgv —— assembles the manifest's sandbox declaration + the in-container start
// command into a `bwrap ...` argv (read-only host runtime / read-only plugin code / tmpfs /
// network policy), handed off to DialStdio.
func sandboxStdioArgv(m *mcpplugin.Manifest, workspaceDir string) ([]string, error) {
	t := &m.Transport
	if t.Sandbox == nil {
		return nil, errors.New("plugin: sandbox_stdio missing sandbox config")
	}
	launch := &sandbox.StdioLaunch{
		CodeDir: t.Sandbox.PluginDir, // plugin code (a read-only artifact materialized by MinIO)
		// WorkspaceDir —— the lazily-provisioned per-session workspace (present only when
		// manifest workspace=true), bound into the sandbox's /workspace; empty means this
		// session has no persistent workspace (only ephemeral tmpfs /tmp).
		WorkspaceDir: workspaceDir,
		Workspace:    t.Sandbox.Workspace, // wants /workspace (falls back to tmpfs with no session)
		Command:      t.Command,
		Args:         t.Args,
		AllowNet:     t.Sandbox.AllowNet,
		// Only a capability that declared a host op gets that one socket bound; the path is
		// derived from id, the manifest never writes a path.
		HostSockets: hostSocketsFor(m),
	}
	argv, err := launch.BwrapArgv()
	if err != nil {
		return nil, fmt.Errorf("plugin: build sandbox argv: %w", err)
	}
	return argv, nil
}

// hostSocketsFor —— the host socket this capability needs bound into the sandbox. Only
// present, and only one, if it declared a host op; not declared → empty (fully offline,
// with no path back at all).
func hostSocketsFor(m *mcpplugin.Manifest) []string {
	if m.Transport.Sandbox == nil || len(m.Transport.Sandbox.HostOps) == 0 {
		return []string{}
	}
	return []string{hostop.SocketPath(m.ID)}
}

// workspaceProvisioner —— the per-session workspace allocator injected by the composition
// root (implemented by internal/sandboxws.Manager.Provision). nil = no workspace subsystem
// (eval / not configured).
var workspaceProvisioner func(sessionID string) (string, error)

// SetWorkspaceProvisioner —— composition root injects the workspace allocator.
func SetWorkspaceProvisioner(fn func(sessionID string) (string, error)) {
	workspaceProvisioner = fn
}

// provisionWorkspaceFor —— when the manifest declares workspace=true and there's a session
// id, lazily provisions and returns this session's workspace host path; otherwise / on
// failure → empty (the sandbox has no /workspace).
func provisionWorkspaceFor(m *mcpplugin.Manifest, sessionID string) string {
	if !wantsWorkspace(m, sessionID) {
		return ""
	}
	dir, err := workspaceProvisioner(sessionID)
	if err != nil {
		return ""
	}
	return dir
}

// wantsWorkspace —— whether this dial should get a persistent workspace allocated: the
// plugin declares workspace, there's a session id, and a provisioner is injected.
func wantsWorkspace(m *mcpplugin.Manifest, sessionID string) bool {
	s := m.Transport.Sandbox
	return s != nil && s.Workspace && sessionID != "" && workspaceProvisioner != nil
}

func wrapDial(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("plugin dial: %w", err)
}

// dial.go —— mcpAppFiber's transport-dialing sub-concern: dials a
// manifest's Transport (stdio / http / in_process / sandbox_stdio) into an mcpclient
// session. Split out of mounted.go to keep it under the max-lines 350 ceiling. Unified:
// all four kinds go through the same entry point, dialMCPApp, only the underlying
// implementation differs.

package mount

import (
	"context"
	"errors"
	"fmt"
	"maps"

	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/infra/sandbox"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
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
	context.Context, *plugin.Manifest, string,
) (*mcpclient.Session, error){
	plugin.TransportStdio:        dialStdio,
	plugin.TransportHTTP:         dialHTTP,
	plugin.TransportInProcess:    dialInProcess,
	plugin.TransportSandboxStdio: dialSandboxStdio,
}

// DialBlock —— dial a block's transport into an initialized session, for a HOST-side caller that
// invokes the block's tools directly rather than exposing them to the visitor agent. This is what
// lets a block SERVE a seam: a supplier (e.g. the calendar block backing the calendar seam) dials
// the block and calls its tools. No per-session workspace (a seam call is stateless).
//
// DialBlock —— dial a block's transport into an initialized session, for a HOST-side caller that
// invokes the block's tools directly rather than exposing them to the visitor agent. This is what
// lets a block SERVE a seam: a supplier (e.g. the CalDAV block backing the calendar seam) dials the
// block and calls its tools. Same dial the visitor path uses; the caller owns Close. No per-session
// workspace (a seam call is stateless), so workspaceDir is empty.
func DialBlock(ctx context.Context, m *plugin.Manifest) (*mcpclient.Session, error) {
	return dialMCPApp(ctx, m, "")
}

// dialMCPApp —— looks up transportDialers and dispatches. Unknown kind → error. The error
// is folded into ErrHidden by VisitorBinding; this function is only responsible for dialing.
func dialMCPApp(
	ctx context.Context, m *plugin.Manifest, workspaceDir string,
) (*mcpclient.Session, error) {
	d, ok := transportDialers[m.Transport.Kind]
	if !ok {
		return nil, fmt.Errorf("plugin: unknown transport kind %q", m.Transport.Kind)
	}
	return d(ctx, m, workspaceDir)
}

func dialStdio(ctx context.Context, m *plugin.Manifest, _ string) (*mcpclient.Session, error) {
	t := &m.Transport
	sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
	return sess, wrapDial(err)
}

func dialHTTP(ctx context.Context, m *plugin.Manifest, _ string) (*mcpclient.Session, error) {
	t := &m.Transport
	sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
	return sess, wrapDial(err)
}

func dialInProcess(
	ctx context.Context, m *plugin.Manifest, _ string,
) (*mcpclient.Session, error) {
	// The manifest carries this as `any` because a YAML declaration cannot name a Go
	// value; whoever built the manifest in memory put a server here. A wrong type is
	// a wiring bug in that builder, so it fails loudly rather than dialling nothing.
	srv, ok := m.Transport.InProcessServer.(*server.MCPServer)
	if !ok {
		return nil, wrapDial(fmt.Errorf(
			"in_process transport for %q carries %T, not an MCP server",
			m.ID, m.Transport.InProcessServer))
	}
	sess, err := mcpclient.DialInProcess(ctx, srv)
	return sess, wrapDial(err)
}

// dialSandboxStdio —— the main process starts the third-party server inside a bubblewrap
// isolation environment (read-only host runtime + read-only plugin code + a per-session
// workspace + tmpfs /tmp + no network by default, unable to touch the host); stdio passes
// transparently through bwrap's stdin/stdout, so dialing is still a plain DialStdio, just
// with the command wrapped in `bwrap`. A non-empty workspaceDir gets bound into the
// sandbox's /workspace (writable, persists across turns).
func dialSandboxStdio(
	ctx context.Context, m *plugin.Manifest, workspaceDir string,
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
func sandboxStdioArgv(m *plugin.Manifest, workspaceDir string) ([]string, error) {
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
		// Only a block that declared a host op gets that one socket bound; the path is
		// derived from id, the manifest never writes a path.
		HostSockets: hostSocketsFor(m),
	}
	argv, err := launch.BwrapArgv()
	if err != nil {
		return nil, fmt.Errorf("plugin: build sandbox argv: %w", err)
	}
	return argv, nil
}

// hostSocketsFor —— the host socket this block needs bound into the sandbox. Only
// present, and only one, if it declared a host op; not declared → empty (fully offline,
// with no path back at all).
func hostSocketsFor(m *plugin.Manifest) []string {
	if m.Transport.Sandbox == nil || len(m.Transport.Sandbox.HostOps) == 0 {
		return []string{}
	}
	return []string{hostop.SocketPath(m.ID)}
}

// nativeKeyIssuer —— injected by the composition root; mints/revokes the per-mount native key a
// sandboxed block presents on its reach-back (rule 4). nil = not configured (eval), so no key is
// minted and the reach-back is unauthenticated (still socket-confined) — enforcement flips on once
// every block presents its key.
var nativeKeyIssuer *nativekey.Issuer

// SetNativeKeyIssuer —— composition root injects the issuer.
func SetNativeKeyIssuer(i *nativekey.Issuer) { nativeKeyIssuer = i }

// withNativeKey —— for a sandboxed block that reaches back (declares host ops), mint a native key
// bound to fiberID and return a COPY of the manifest carrying it in this dial's env, plus the key
// (the caller revokes it when the dial closes). No issuer / not a reach-back block → the manifest
// unchanged and an empty key. The manifest is copied (its Env cloned) so the per-dial secret never
// lands on the shared manifest — two sessions of one block get two keys.
func withNativeKey(m *plugin.Manifest, fiberID string) (plugin.Manifest, nativekey.Key) {
	if !reachBackKeyWanted(m) {
		return *m, ""
	}
	k, err := nativeKeyIssuer.Issue(fiberID)
	if err != nil {
		return *m, "" // mint failed → dial without a key; the reach-back stays socket-confined
	}
	dialed := *m
	// Reveal() here is the delivery into the block's own confined sandbox env — the one place the
	// value leaves the type. check-native-key-confined allowlists this caller.
	dialed.Transport.Env = clonedEnvWith(m.Transport.Env, plugin.NativeKeyEnv, k.Reveal())
	return dialed, k
}

// reachBackKeyWanted —— a block gets a native key only if an issuer is configured and it declares
// host ops (it reaches back). A non-reach-back or third-party block gets none.
func reachBackKeyWanted(m *plugin.Manifest) bool {
	s := m.Transport.Sandbox
	return nativeKeyIssuer != nil && s != nil && len(s.HostOps) > 0
}

// clonedEnvWith —— a copy of env with one key set (never mutates the caller's map).
func clonedEnvWith(env map[string]string, key, val string) map[string]string {
	out := maps.Clone(env)
	if out == nil {
		out = map[string]string{}
	}
	out[key] = val
	return out
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
func provisionWorkspaceFor(m *plugin.Manifest, sessionID string) string {
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
func wantsWorkspace(m *plugin.Manifest, sessionID string) bool {
	s := m.Transport.Sandbox
	return s != nil && s.Workspace && sessionID != "" && workspaceProvisioner != nil
}

func wrapDial(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("plugin dial: %w", err)
}

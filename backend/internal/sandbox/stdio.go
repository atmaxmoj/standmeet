// stdio.go —— sandboxed launch for LONG-RUNNING stdio MCP servers.
//
// sandbox.go's Runner is one-shot: run a script, capture stdout, container dies.
// A third-party MCP server is the opposite — a long-lived process speaking
// JSON-RPC over stdin/stdout for the whole session. So instead of capturing
// output we keep the process alive with its pipes open and let the normal MCP
// stdio transport (mcpclient.DialStdio) talk through it.
//
// The whole point is one sentence: when an MCP server runs (for a VISITOR, in
// their chat), it must not be able to fuck the host up — nor see another
// visitor's data. We get that with bubblewrap (bwrap), Flatpak's unprivileged
// sandbox — NOT a docker image, not a VM, not a daemon. It is "just an isolation
// environment": a throwaway mount/namespace for one process.
//
// Three storage layers, by lifetime + owner (converged design):
//
//   - CODE  (/plugin, READ-ONLY)  the MCP server's own code. Installed ONCE by
//     the owner, stored durably in object storage (MinIO), materialized here and
//     bind-mounted read-only. All visitors share this one immutable copy.
//   - WORKSPACE (/workspace, READ-WRITE)  per-VISITOR-SESSION scratch+data. Each
//     session gets its OWN directory so one visitor never sees another's files.
//     Lazily provisioned — a session that never writes leaves no directory — so
//     it is only mounted when WorkspaceDir is non-empty.
//   - /tmp (tmpfs)  disposable in-memory scratch, gone with the process.
//
// The server sees nothing else of the host: no /etc, no home, no other data; and
// with --unshare-net, no network unless the plugin opts in.

package sandbox

import (
	"errors"
	"fmt"
	"path/filepath"
)

// StdioLaunch —— a third-party stdio MCP server to run sandboxed for one visitor
// session. CodeDir holds the server's installed code (materialized from object
// storage), mounted read-only at /plugin. WorkspaceDir is this session's own
// writable area, mounted at /workspace — leave it "" for a session that should
// get no persistent workspace (lazy). Command/Args boot the server (cwd =
// /plugin) using a host interpreter from the read-only /usr. AllowNet opts a
// plugin (yt-dlp class) into networking; default is none.
type StdioLaunch struct {
	CodeDir      string
	WorkspaceDir string
	Command      string
	Args         []string
	// HostSockets —— host unix sockets bind-mounted into the sandbox at the same
	// path. This is how a builtin reaches a NARROW host interface (a corpus /
	// inference / booking API) without any network: a unix socket is filesystem,
	// not a network namespace, so it stays reachable even under --unshare-net.
	// Third-party plugins get none; a builtin gets exactly the one socket it needs.
	HostSockets []string
	AllowNet    bool
	// Workspace —— this plugin wants a /workspace mount. With WorkspaceDir set it's
	// the persistent per-session dir (--bind); without (a sessionless dial, e.g.
	// reading instructions) it's an ephemeral tmpfs so a server rooted at /workspace
	// still starts. Plugins that don't want a workspace get neither.
	Workspace bool
}

const (
	codeMountTarget      = "/plugin"
	workspaceMountTarget = "/workspace"
)

// hostRuntimeBinds —— host paths bind-mounted READ-ONLY so the interpreter
// (node/python) and its shared libraries are available inside the sandbox. Being
// read-only, the server can run but cannot modify the host toolchain. No /etc,
// /home, /root, /var or app data is exposed.
var hostRuntimeBinds = []string{"/usr", "/bin", "/sbin", "/lib", "/lib64"}

// netBinds —— extra read-only host files an AllowNet plugin needs for real
// networking: DNS resolution + CA certificates. Only added when AllowNet.
var netBinds = []string{"/etc/resolv.conf", "/etc/ssl", "/etc/ca-certificates"}

// BwrapArgv —— the full bubblewrap argv that runs this server confined. Returned
// as argv (no shell) so the caller hands it straight to the stdio transport with
// zero shell-injection surface.
func (l *StdioLaunch) BwrapArgv() ([]string, error) {
	if err := l.validate(); err != nil {
		return nil, err
	}
	argv := baseBwrapArgv()
	for _, p := range hostRuntimeBinds {
		argv = append(argv, "--ro-bind-try", p, p) // -try: skip if absent on this distro
	}
	// CODE: the server's installed code, read-only; the only host path it always
	// sees, and it cannot modify it.
	argv = append(argv, "--ro-bind", l.CodeDir, codeMountTarget, "--chdir", codeMountTarget)
	argv = l.appendWorkspace(argv)
	argv = l.appendSockets(argv)
	argv = l.appendNetwork(argv)
	argv = append(argv, "--", l.Command)
	return append(argv, l.Args...), nil
}

// validate —— bind-mount sources must be absolute; command required.
func (l *StdioLaunch) validate() error {
	if !filepath.IsAbs(l.CodeDir) {
		return fmt.Errorf("sandbox stdio: code dir must be absolute, got %q", l.CodeDir)
	}
	if l.WorkspaceDir != "" && !filepath.IsAbs(l.WorkspaceDir) {
		return fmt.Errorf("sandbox stdio: workspace dir must be absolute, got %q", l.WorkspaceDir)
	}
	if l.Command == "" {
		return errors.New("sandbox stdio: command is required")
	}
	return firstNonAbs(l.HostSockets, "host socket")
}

// firstNonAbs —— err if any path isn't absolute (bind-mount sources must be).
func firstNonAbs(paths []string, what string) error {
	for _, p := range paths {
		if !filepath.IsAbs(p) {
			return fmt.Errorf("sandbox stdio: %s must be absolute, got %q", what, p)
		}
	}
	return nil
}

// baseBwrapArgv —— the static isolation flags every sandboxed server gets.
func baseBwrapArgv() []string {
	return []string{
		"--die-with-parent", // server dies when the session (bwrap's parent) ends
		"--unshare-pid",     // own PID namespace — can't see/signal host procs
		"--unshare-uts",
		"--unshare-ipc",
		"--new-session", // detach from controlling TTY
		"--proc", "/proc",
		"--dev", "/dev",
		"--tmpfs", "/tmp",
		"--setenv", "HOME", "/tmp",
	}
}

// appendWorkspace —— mount /workspace for a workspace-wanting plugin: the
// persistent per-session dir when provisioned (--bind, writable, survives the
// turn), else an ephemeral tmpfs (sessionless dial, so a server rooted at
// /workspace still boots). Plugins that don't want a workspace get nothing.
func (l *StdioLaunch) appendWorkspace(argv []string) []string {
	if l.WorkspaceDir != "" {
		return append(argv, "--bind", l.WorkspaceDir, workspaceMountTarget)
	}
	if l.Workspace {
		return append(argv, "--tmpfs", workspaceMountTarget)
	}
	return argv
}

// appendSockets —— bind each narrow host socket into the sandbox at its own
// path. Survives --unshare-net (a unix socket is filesystem, not network), so a
// builtin reaches its host API with zero network access.
func (l *StdioLaunch) appendSockets(argv []string) []string {
	for _, s := range l.HostSockets {
		argv = append(argv, "--bind", s, s)
	}
	return argv
}

// appendNetwork —— AllowNet binds the DNS/CA files real networking needs;
// otherwise the server gets no network namespace at all.
func (l *StdioLaunch) appendNetwork(argv []string) []string {
	if !l.AllowNet {
		return append(argv, "--unshare-net")
	}
	for _, p := range netBinds {
		argv = append(argv, "--ro-bind-try", p, p)
	}
	return argv
}

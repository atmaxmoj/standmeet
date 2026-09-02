// Package sandbox runs untrusted owner-curated scripts inside disposable
// docker containers. Design ported from legacy
// standmeet-server/gateway/src/runtime/sandbox.ts, reworked as a Go
// subprocess call to `docker run`.
//
// Security model:
//   - --network=none  → script can't reach the network
//   - --read-only     → root fs is not writable
//   - --tmpfs /tmp    → 64MB scratch disk
//   - --memory + --cpus → resource caps
//   - --rm            → container is GC'd once it finishes
//   - args are passed as a JSON string via the ARGS env var; the script
//     parses it with the language's built-in env access
//
// Runner is an interface so dev/prod use docker while untrusted
// environments fall back to disabled.
package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"time"
)

// Runner —— sandbox backend abstraction. Implementations: DockerRunner /
// DisabledRunner.
type Runner interface {
	Run(ctx context.Context, in *RunInput) (Result, error)
}

// RunInput —— Run's arguments.
type RunInput struct {
	Language string // 'python' | 'bash' | 'javascript'
	Script   string // the script source
	ArgsJSON string // JSON string, passed to the script as the ARGS env var
	Timeout  time.Duration
}

// Result —— the script's execution result.
type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
	TimedOut bool
}

// ErrDisabled —— SANDBOX_DRIVER=disabled, or the driver was never initialized.
var ErrDisabled = errors.New("sandbox: disabled")

// ErrUnsupportedLanguage —— language isn't on the allowlist.
var ErrUnsupportedLanguage = errors.New("sandbox: unsupported language")

const (
	defaultTimeout  = 30 * time.Second
	memoryLimit     = "256m"
	cpuLimit        = "0.5"
	tmpfsSize       = "size=64m"
	maxOutputBytes  = 1 << 20 // 1MB stdout+stderr cap
	killGracePeriod = 5 * time.Second
)

// languageImages —— the allowlist + its docker image for each. Owner picks
// one of these languages when writing a skill script. Adding a new language
// goes through PR review.
var languageImages = map[string]string{
	"python":     "python:3.11-slim",
	"bash":       "bash:5",
	"javascript": "node:20-slim",
}

// DockerRunner —— calls the local docker daemon via the docker CLI
// (typically by mounting /var/run/docker.sock into the backend container).
type DockerRunner struct{}

// NewDockerRunner constructs a DockerRunner.
func NewDockerRunner() *DockerRunner { return &DockerRunner{} }

// Run executes the script. Returns Result + err; err is non-nil only during
// setup (unsupported language / docker unavailable) — the script's own
// nonzero exit code is reported through Result instead.
func (*DockerRunner) Run(ctx context.Context, in *RunInput) (Result, error) {
	image, ok := languageImages[in.Language]
	if !ok {
		return Result{}, fmt.Errorf("%w: %s", ErrUnsupportedLanguage, in.Language)
	}
	timeout := in.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	cmd := buildDockerCmd(ctx, image, in)
	return runDockerCmd(cmd, timeout)
}

// buildDockerCmd —— assembles `docker run --rm --network=none ...`. Feed the
// script to the interpreter via stdin? No — matching legacy, it's passed
// via -c/-e in argv instead.
//
// The docker command path is hardcoded, and every argument is controlled:
// it comes from the language allowlist plus owner-controlled script
// content; the script itself runs inside the --network=none + --read-only
// sandbox, so the shell-injection attack surface outside the container is
// zero.
//
//nolint:gosec // docker subprocess args are controlled; script content runs inside the sandbox.
func buildDockerCmd(ctx context.Context, image string, in *RunInput) *exec.Cmd {
	argsEnv := in.ArgsJSON
	if argsEnv == "" {
		argsEnv = "{}"
	}
	interp := interpreterFor(in.Language)
	args := []string{
		"run", "--rm",
		"--network=none",
		"--memory=" + memoryLimit,
		"--cpus=" + cpuLimit,
		"--read-only",
		"--tmpfs", "/tmp:" + tmpfsSize,
		"--env", "ARGS=" + argsEnv,
		image,
		interp[0], interp[1], in.Script,
	}
	return exec.CommandContext(ctx, "docker", args...)
}

func interpreterFor(language string) [2]string {
	switch language {
	case "python":
		return [2]string{"python3", "-c"}
	case "javascript":
		return [2]string{"node", "-e"}
	default: // bash
		return [2]string{"bash", "-c"}
	}
}

// runDockerCmd —— exec docker, wait, cap output. Timeout triggers a context
// cancel that kills `docker run`; the container's --rm cleans it up
// automatically.
func runDockerCmd(cmd *exec.Cmd, timeout time.Duration) (Result, error) {
	deadline := time.Now().Add(timeout)
	stdoutBuf := newCappedBuffer(maxOutputBytes)
	stderrBuf := newCappedBuffer(maxOutputBytes)
	cmd.Stdout = stdoutBuf
	cmd.Stderr = stderrBuf
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("sandbox: start docker: %w", err)
	}
	timedOut := waitOrKill(cmd, deadline)
	exitCode := waitExitCode(cmd)
	return Result{
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		ExitCode: exitCode,
		TimedOut: timedOut,
	}, nil
}

func waitOrKill(cmd *exec.Cmd, deadline time.Time) bool {
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
		return false
	case <-time.After(time.Until(deadline)):
		killAndDrain(cmd, done)
		return true
	}
}

// killAndDrain —— deadline hit: SIGKILL, then wait for Wait to land (up to
// killGracePeriod). A failed drain doesn't affect the caller — Result.ExitCode
// is already read from ProcessState.
func killAndDrain(cmd *exec.Cmd, done <-chan error) {
	if kerr := cmd.Process.Kill(); kerr != nil {
		_ = kerr
	}
	select {
	case <-done:
	case <-time.After(killGracePeriod):
	}
}

func waitExitCode(cmd *exec.Cmd) int {
	if cmd.ProcessState == nil {
		return -1
	}
	return cmd.ProcessState.ExitCode()
}

// DisabledRunner —— returns ErrDisabled when the sandbox isn't enabled. This
// is the production default; only DockerRunner runs, and only once the owner
// explicitly sets SANDBOX_DRIVER=docker.
type DisabledRunner struct{}

// NewDisabledRunner constructs a DisabledRunner.
func NewDisabledRunner() *DisabledRunner { return &DisabledRunner{} }

// Run always returns ErrDisabled.
func (*DisabledRunner) Run(_ context.Context, _ *RunInput) (Result, error) {
	return Result{}, ErrDisabled
}

// FromEnv —— picks a Runner from the driver string. Empty / "disabled" →
// DisabledRunner; "docker" → DockerRunner. Called by the composition root.
// A driver-selection factory must return an interface (allow-listed in
// .golangci.yml ireturn).
func FromEnv(driver string) Runner {
	if driver == "docker" {
		return NewDockerRunner()
	}
	return NewDisabledRunner()
}

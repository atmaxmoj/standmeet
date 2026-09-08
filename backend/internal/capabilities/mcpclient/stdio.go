// stdio.go —— C2: MCP stdio transport (core spawns the plugin as a subprocess and
// talks over stdin/stdout). Same Session/Initialize shape as Dial(http), just with a
// spawned-process transport.

package mcpclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// initRequest —— the shared MCP initialize params (http / stdio use the same handshake).
func initRequest() mcpgo.InitializeRequest {
	return mcpgo.InitializeRequest{
		Params: mcpgo.InitializeParams{
			ProtocolVersion: mcpgo.LATEST_PROTOCOL_VERSION,
			ClientInfo: mcpgo.Implementation{
				Name: "standmeet-backend", Version: "0.1.0",
			},
		},
	}
}

// dialTiming —— on a dial failure, writes "how long it took" and "who canceled it"
// into the error string.
//
// Why this is needed: the failure log alone just says `stdio initialize: transport
// error: context canceled`, and `context canceled` (the parent ctx got canceled) versus
// `deadline exceeded` (hit our own dialTimeout) are completely different diseases ——
// the former is **the caller giving up first** (the HTTP request got cut), the latter
// is the plugin genuinely failing to come up. That one line alone can't tell how long
// the cold start actually took, nor whether the fix is a bigger budget or a faster
// spawn. Carrying the parent ctx's state along makes the root cause readable straight
// from the log, instead of needing a guess.
func dialTiming(parent context.Context, spawnMS int64, initStart time.Time) string {
	cause := "parent-live"
	switch {
	case errors.Is(parent.Err(), context.Canceled):
		cause = "parent-canceled(caller gave up first)"
	case errors.Is(parent.Err(), context.DeadlineExceeded):
		cause = "parent-deadline"
	default: // parent still live: the failure is the plugin's own, not a caller giving up
	}
	return fmt.Sprintf("[spawn=%dms init=%dms budget=%s %s]",
		spawnMS, time.Since(initStart).Milliseconds(), dialTimeout, cause)
}

// childStderrBudget —— how much of the child's stderr we quote, and how long we
// wait for it. A crashing interpreter prints its traceback and exits immediately,
// so the read returns at EOF long before the deadline; the deadline only exists so
// a child that came up but failed initialize for another reason (still holding the
// pipe open) cannot wedge the dial.
const (
	childStderrBudget  = 2048
	childStderrTimeout = 500 * time.Millisecond
)

// childStderr —— whatever the subprocess printed to stderr, bounded in bytes and in
// time, as a single line ready to append to a dial error.
//
// Why this is needed: an MCP server that dies at STARTUP (bad import, missing
// interpreter, syntax error) never speaks JSON-RPC, so the transport reports only
// `transport closed` — a symptom shared by every startup failure there is. The child
// has meanwhile printed the exact cause and nobody read it. Diagnosing that from the
// log alone is impossible; you have to re-run the plugin by hand inside the
// container, which production does not allow.
// (Cost, 2026-09-08: `plugin dial: mcp server unreachable: stdio initialize [...]:
// transport closed` took an hour to trace to a one-line `ImportError: cannot import
// name 'McpError'` the child had already printed.)
func childStderr(cli *mcpgoclient.Client) string {
	r, ok := mcpgoclient.GetStderr(cli)
	if !ok || r == nil {
		return ""
	}
	done := make(chan string, 1)
	go func() {
		b, rerr := io.ReadAll(io.LimitReader(r, childStderrBudget))
		_ = rerr // whatever arrived before the error is still the answer
		done <- strings.TrimSpace(string(b))
	}()
	select {
	case s := <-done:
		return quoteStderr(s)
	case <-time.After(childStderrTimeout):
		return ""
	}
}

// quoteStderr —— one log-safe line: empty stays empty, newlines become " | " so the
// whole traceback survives inside a single structured log field.
func quoteStderr(s string) string {
	if s == "" {
		return ""
	}
	return " child-stderr: " + strings.ReplaceAll(s, "\n", " | ")
}

// closeQuietly —— closes the client ignoring the error (releases the subprocess / transport).
func closeQuietly(cli *mcpgoclient.Client) {
	cerr := cli.Close()
	_ = cerr
}

// DialStdio —— spawns command (with args/env) as an MCP server subprocess over the
// stdio transport, returning a Session after Initialize. env is extra variables
// appended on top of os.Environ() (mcp-go merges the inheritance itself). Command
// doesn't exist / initialize times out (whichever of ctx or dialTimeout hits first) →
// returns ErrUnreachable and reaps the already-spawned subprocess, leaving no zombie
// and never hanging forever.
func DialStdio(
	ctx context.Context, command string, args []string, env map[string]string,
) (*Session, error) {
	spawnStart := time.Now()
	cli, err := mcpgoclient.NewStdioMCPClient(command, envSlice(env), args...)
	if err != nil {
		return nil, fmt.Errorf("%w: stdio start %s: %w", ErrUnreachable, command, err)
	}
	spawnMS := time.Since(spawnStart).Milliseconds()
	ictx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	initStart := time.Now()
	res, ierr := cli.Initialize(ictx, initRequest())
	if ierr != nil {
		// Drain stderr BEFORE Close: Close reaps the process, which shuts the pipe
		// and would throw away the very traceback we need.
		stderr := childStderr(cli)
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: stdio initialize %s: %w%s",
			ErrUnreachable, dialTiming(ctx, spawnMS, initStart), ierr, stderr)
	}
	return &Session{
		c: cli, url: "stdio:" + command, instructions: initInstructions(res),
		closeFn: func() { closeQuietly(cli) },
	}, nil
}

// envSlice —— map → []string{"K=V"} (mcp-go appends these on top of os.Environ()).
func envSlice(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}

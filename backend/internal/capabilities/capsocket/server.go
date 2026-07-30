// Package capsocket —— host-side NARROW unix-socket APIs that sandboxed builtins
// reach over a bind-mounted socket while fully network-isolated (--unshare-net).
//
// Each data builtin (summarize / corpus / booking) gets its OWN socket serving
// only the op(s) that capability needs — never general DB or LLM access. The
// builtin's MCP tool lives in its sandboxed plugin; this is just the compute/data
// plumbing the plugin calls, the same way it would call the database. So "core
// has no specific MCP capability" holds: the capability is the plugin, this is a
// host service it talks to.
//
// Wire protocol: newline-delimited JSON, one request -> one response per line.
//
//	request : {"op":"<name>", ...op-specific fields...}
//	response: {...op-specific fields..., "error":"<msg or empty>"}
//
// The trusted session identity (owner/conversation/...) is part of the request —
// the host plants it on the plugin's tool-call `_meta`, the plugin forwards it
// here. The socket file is owner-only (0600) and reachable only inside the
// sandbox it's bound into.
package capsocket

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
)

const (
	socketMode    = 0o600
	maxRequestLen = 16 * 1024 * 1024
)

// Handler —— decode the op's request, do the work, return the JSON response bytes.
// Returning an error puts {"error":...} on the wire (the plugin folds it into a
// tool error); it never kills the server. Response is json.RawMessage (not `any`)
// so handlers — which live next to their usecase deps — stay typed.
type Handler func(ctx context.Context, req json.RawMessage) (json.RawMessage, error)

// Server —— a unix-socket listener dispatching line-delimited JSON requests to
// per-op handlers. One Server per builtin socket.
type Server struct {
	ln       net.Listener
	log      *slog.Logger
	handlers map[string]Handler
	path     string
}

// Listen —— create+bind the socket at path (replacing a stale file), 0600. The
// caller registers ops, then runs Serve in a goroutine and Close on shutdown.
func Listen(ctx context.Context, path string, log *slog.Logger) (*Server, error) {
	if err := clearStale(path); err != nil {
		return nil, err
	}
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "unix", path)
	if err != nil {
		return nil, fmt.Errorf("capsocket: listen %q: %w", path, err)
	}
	if cherr := chmodOrClose(ln, path, log); cherr != nil {
		return nil, cherr
	}
	return &Server{ln: ln, log: log, handlers: map[string]Handler{}, path: path}, nil
}

func clearStale(path string) error {
	if rmErr := os.Remove(path); rmErr != nil && !os.IsNotExist(rmErr) {
		return fmt.Errorf("capsocket: clear %q: %w", path, rmErr)
	}
	return nil
}

func chmodOrClose(ln net.Listener, path string, log *slog.Logger) error {
	if cherr := os.Chmod(path, socketMode); cherr != nil {
		if cerr := ln.Close(); cerr != nil {
			log.Warn("capsocket: close after chmod fail", "err", cerr)
		}
		return fmt.Errorf("capsocket: chmod %q: %w", path, cherr)
	}
	return nil
}

// Handle —— register an op. Call before Serve.
func (s *Server) Handle(op string, h Handler) { s.handlers[op] = h }

// Serve —— accept loop; one goroutine per connection. Blocks until Close. ctx is
// the server-lifetime context (the same one passed to Listen), threaded down to
// each request's handler.
func (s *Server) Serve(ctx context.Context) {
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return // listener closed
		}
		go s.handleConn(ctx, conn)
	}
}

// Close —— stop accepting + remove the socket file.
func (s *Server) Close() error {
	if rmErr := os.Remove(s.path); rmErr != nil && !os.IsNotExist(rmErr) {
		s.log.Warn("capsocket: remove socket", "path", s.path, "err", rmErr)
	}
	if err := s.ln.Close(); err != nil {
		return fmt.Errorf("capsocket: close listener: %w", err)
	}
	return nil
}

func (s *Server) handleConn(ctx context.Context, conn net.Conn) {
	defer func() {
		if cerr := conn.Close(); cerr != nil {
			s.log.Debug("capsocket: conn close", "err", cerr)
		}
	}()
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 64*1024), maxRequestLen)
	for sc.Scan() {
		resp := s.dispatch(ctx, sc.Bytes())
		if _, werr := conn.Write(append(resp, '\n')); werr != nil {
			return
		}
	}
}

type opEnvelope struct {
	Op string `json:"op"`
}

// dispatch —— route one request to its handler; unknown op or handler error
// becomes an {"error":...} envelope (never panics the connection).
func (s *Server) dispatch(ctx context.Context, raw []byte) json.RawMessage {
	var env opEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return errResp("bad request: " + err.Error())
	}
	h, ok := s.handlers[env.Op]
	if !ok {
		s.log.Warn("capsocket: unknown op", "op", env.Op)
		return errResp("unknown op: " + env.Op)
	}
	out, err := h(ctx, raw)
	if err != nil {
		// Say it out loud. The reply travels back into a sandbox that is free to swallow it
		// (best-effort paths do exactly that), so without this the host side of a failed
		// reach-back leaves no trace at all — the failure looks like "the cap simply did nothing".
		s.log.Error("capsocket: op failed", "op", env.Op, "err", err)
		return errResp(err.Error())
	}
	return out
}

func errResp(msg string) json.RawMessage {
	b, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return json.RawMessage(`{"error":"internal"}`)
	}
	return b
}

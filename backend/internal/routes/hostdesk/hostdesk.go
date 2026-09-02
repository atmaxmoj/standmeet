// Package hostdesk — the inbound convergence point: a capability inside the sandbox that
// needs something back from the host can only ask for it here.
//
// It mirrors the outbound convergence point (internal/routes/dispatcher):
//
//	outbound domain declares Op     → facade re-exports → dispatcher.Collect → per face
//	inbound  domain declares HostOp → facade re-exports → hostdesk.Collect → per-cap socket
//
// Why this place exists: a capability has no network of its own, only one unix socket toward
// the host. Before this, **each capability stood up its own socket and hung its own verbs on
// it**, so the question "what can the sandbox ask the host for" had no answer — you had to
// read four hand-wired wiring functions to piece it together, and anyone could hang a new verb
// on it.
//
// Now this list is that answer. A capability orders by name in its own manifest
// (Transport.Sandbox.HostOps); the host serves by declaration. Ordering a name that isn't
// here → **the process blows up at startup**, instead of surfacing only once the owner clicks
// something.
//
// The convergence point implements nothing itself: it imports each domain's front door plus
// the two axes' own mechanisms, and gathers the declarations together.
package hostdesk

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	capconfigroutes "github.com/atmaxmoj/standmeet/internal/routes/capconfig"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
	connectorroutes "github.com/atmaxmoj/standmeet/internal/routes/connector"
)

// SocketDir — where every capability's socket lands (the path rule lives in hostop; the
// loader computes the same one).
const SocketDir = hostop.SocketDir

// Deps — the dependency bundle each domain needs to declare its host ops; the assembly root
// fills it in.
//
// The two things in PerCapability (its own store, its own config) differ per **capability**
// (bound to its own namespace at construction time), so they don't live here — Collect's
// caller supplies them per capability.
type Deps struct {
	Conversation conversation.OpsHost
	Corpus       *corpus.IndexDeps
	Owners       owner.OpsHostLookup
	Connectors   connectorroutes.Invoker
}

// PerCapability — the two things that belong to only one capability: its own isolated store,
// its own declared config.
//
// They must be constructed per capability — the store a capability gets is already bound to
// its own namespace, so it cannot fill in anyone else's table. This isolation is built in at
// construction time, not checked per request.
type PerCapability struct {
	Store  capstoreroutes.BoundStore
	Config capconfigroutes.BoundConfig
}

// Collect — the full set of host ops the host opens to the sandbox. One line per source; the
// convergence point only gathers.
//
// When a source has nothing to give this time (this capability didn't ask for a store, didn't
// declare config), **the source itself** returns empty; the convergence point doesn't track
// conditions for each source — once it starts tracking, adding one more source means editing
// this file, and that is exactly what the convergence point exists to eliminate.
func Collect(d *Deps, per *PerCapability) []hostop.Op {
	if per == nil {
		per = &PerCapability{}
	}
	ops := conversation.HostOps(d.Conversation)
	ops = append(ops, corpus.CorpusHostOpsFor(d.Corpus)...)
	ops = append(ops, owner.HostOps(d.Owners)...)
	ops = append(ops, connectorroutes.Ops(d.Connectors)...)
	ops = append(ops, capstoreroutes.Ops(per.Store)...)
	ops = append(ops, capconfigroutes.Ops(per.Config)...)
	return ops
}

// Serve — opens, for one capability, the ops it **ordered by name**; the socket path is
// derived from the id.
//
// Ordering a name the convergence point doesn't have → an error (the assembly root uses this
// to blow up at startup). Leaving out a name means that call is unreachable — never that it
// can still be called on the sly. Default is off.
func Serve(
	ctx context.Context, log *slog.Logger, pluginID string, want []string, all []hostop.Op,
) (*capsocket.Server, error) {
	return ServeAt(ctx, log, &ServeInput{
		PluginID: pluginID, Want: want, All: all, SockPath: SocketPath(pluginID),
	})
}

// ServeAt — same as above, but the caller supplies the socket path.
//
// Built for eval's mini-host: it runs on macOS, which has no /run, but the step of **picking
// which ops** must still be this same one — the vocabulary and the "error on an unlisted
// name" rule cannot become a second, separate set just because the path changed.
func ServeAt(ctx context.Context, log *slog.Logger, in *ServeInput) (*capsocket.Server, error) {
	handlers, err := pick(in.PluginID, in.Want, in.All)
	if err != nil {
		return nil, err
	}
	srv, lerr := capsocket.ListenWith(ctx, in.SockPath, handlers, log)
	if lerr != nil {
		return nil, fmt.Errorf("hostdesk: %w", lerr)
	}
	go srv.Serve(ctx)
	return srv, nil
}

// ServeInput — ServeAt's arguments: who to open for, which ops, what the vocabulary is, and
// where the socket lands.
type ServeInput struct {
	PluginID string
	SockPath string
	Want     []string
	All      []hostop.Op
}

// SocketPath — where one capability's socket lands. The host derives it; the manifest never
// writes it.
func SocketPath(pluginID string) string {
	return hostop.SocketPath(pluginID)
}

func pick(
	pluginID string, want []string, all []hostop.Op,
) (map[string]capsocket.Handler, error) {
	byName := byOpName(all)
	out := make(map[string]capsocket.Handler, len(want))
	for _, name := range want {
		invoke, ok := byName[name]
		if !ok {
			return nil, fmt.Errorf(
				"hostdesk: capability %q asks for host op %q, which the host does not publish",
				pluginID, name)
		}
		out[name] = capsocket.Handler(invoke)
	}
	return out, nil
}

// byOpName — indexes the vocabulary by name, once.
func byOpName(all []hostop.Op) map[string]hostop.Invoke {
	byName := make(map[string]hostop.Invoke, len(all))
	for i := range all {
		byName[all[i].Name] = all[i].Invoke
	}
	return byName
}

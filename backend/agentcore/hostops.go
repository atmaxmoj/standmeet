// hostops.go —— the eval mini-host's stand-in for prod's host desk (internal/routes/hostdesk).
// Runs a plain unix-socket server for the corpus host ops, backed by the Driver's corpus, so the
// REAL retrieval plugin (run over plain stdio, no bwrap) can dial it via HostSocketEnv and
// assemble against the launch's corpus instead of postgres.
//
// The op list is NOT written here — it is whatever the corpus domain declares. The mini-host may
// differ from prod in transport and in backing store; it must not differ in vocabulary, or an eval
// would pass against ops prod does not publish.

package agentcore

import (
	"context"
	"fmt"
	"log/slog"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
)

// HostSocketEnv —— the env var the host puts a capability's socket path in. ONE name for every
// capability: each plugin used to invent its own (RETRIEVAL_SOCKET, BOOKER_SOCKET, …), so the same
// fact had four names and prod had to author the path four times. Prod derives it from the plugin
// id; the mini-host points it at a temp socket. Exported so eval PluginSpecs cannot drift from it.
const HostSocketEnv = "STANDMEET_HOST_SOCKET"

// StartRetrievalSocket —— listen at sockPath and serve the corpus host ops backed by the
// Driver (ACL applied in the bridge). Point a retrieval PluginSpec's HostSocketEnv at
// sockPath. Returns a stop func; call it (defer) when the launch ends.
func StartRetrievalSocket(ctx context.Context, d Driver, sockPath string) (func() error, error) {
	ops := corpus.CorpusHostOps(driverCorpusLister{driver: d})
	handlers := make(map[string]capsocket.Handler, len(ops))
	for i := range ops {
		handlers[ops[i].Name] = capsocket.Handler(ops[i].Invoke)
	}
	srv, err := capsocket.ListenWith(ctx, sockPath, handlers, slog.Default())
	if err != nil {
		return nil, fmt.Errorf("retrieval socket listen: %w", err)
	}
	go srv.Serve(ctx)
	return srv.Close, nil
}

// CorpusHostOpNames —— the corpus host ops a retrieval-shaped plugin orders from the host.
// Eval PluginSpecs declare them by name, exactly as prod manifests do.
func CorpusHostOpNames() []string {
	ops := corpus.CorpusHostOps(nil)
	names := make([]string, 0, len(ops))
	for i := range ops {
		names = append(names, ops[i].Name)
	}
	return names
}

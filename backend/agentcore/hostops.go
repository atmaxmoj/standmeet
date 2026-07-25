// hostops.go —— #154 step 2: the eval mini-host's stand-in for prod's wireRetrievalSocket.
// Runs a plain unix-socket host-op server (corpus_search/read/list) backed by the Driver's
// corpus, so the REAL retrieval plugin (run over plain stdio, no bwrap) can dial it via its
// RETRIEVAL_SOCKET env and assemble against the launch's corpus instead of postgres.

package agentcore

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// StartRetrievalSocket —— listen at sockPath and serve the corpus ops backed by the
// Driver (ACL applied in the bridge). Point a retrieval PluginSpec's RETRIEVAL_SOCKET env
// at sockPath. Returns a stop func; call it (defer) when the launch ends.
func StartRetrievalSocket(ctx context.Context, d Driver, sockPath string) (func() error, error) {
	srv, err := capsocket.Listen(ctx, sockPath, slog.Default())
	if err != nil {
		return nil, fmt.Errorf("retrieval socket listen: %w", err)
	}
	usecases.RegisterCorpusIndexLister(srv, driverCorpusLister{driver: d})
	go srv.Serve(ctx)
	return srv.Close, nil
}

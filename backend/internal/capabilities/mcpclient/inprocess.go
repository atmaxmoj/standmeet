// inprocess.go —— connects to an mcp-go server object living in the **same process**. The
// host uses it to load built-in capability servers shipped with the product: no network,
// no subprocess, no goroutine —— in-memory transport, plain method calls. This is the
// "code decoupled outside, runtime inside the process" loading style: an external module
// hands over a *server.MCPServer, and the host wires it to an in-process client.

package mcpclient

import (
	"context"
	"fmt"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgoserver "github.com/mark3labs/mcp-go/server"
)

// DialInProcess —— connects to an in-process mcp-go server and returns a Session after
// Initialize. Same Session shape as Dial(http) / DialStdio, just with an in-memory
// direct-connect transport.
func DialInProcess(ctx context.Context, srv *mcpgoserver.MCPServer) (*Session, error) {
	cli, err := mcpgoclient.NewInProcessClient(srv)
	if err != nil {
		return nil, fmt.Errorf("%w: in-process client: %w", ErrUnreachable, err)
	}
	if serr := cli.Start(ctx); serr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: in-process start: %w", ErrUnreachable, serr)
	}
	ictx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	res, ierr := cli.Initialize(ictx, initRequest())
	if ierr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: in-process initialize: %w", ErrUnreachable, ierr)
	}
	return &Session{
		c: cli, url: "inproc", instructions: initInstructions(res),
		closeFn: func() { closeQuietly(cli) },
	}, nil
}

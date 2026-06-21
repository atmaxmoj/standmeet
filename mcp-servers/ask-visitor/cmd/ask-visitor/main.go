// Command ask-visitor runs the ask_visitor capability as a standalone stdio MCP
// server. The host launches this binary inside a bubblewrap sandbox via the
// sandbox_stdio transport — the SAME path as any third-party plugin. "builtin"
// is now just an origin tag (the binary ships with the product), not a special
// in-process load. ask_visitor needs no host data, so it gets no HostSockets and
// runs fully network-isolated.
package main

import (
	"fmt"
	"os"

	"github.com/mark3labs/mcp-go/server"

	askvisitor "github.com/atmaxmoj/standmeet/mcp-servers/ask-visitor"
)

func main() {
	if err := server.ServeStdio(askvisitor.NewMCPServer()); err != nil {
		fmt.Fprintln(os.Stderr, "ask-visitor:", err)
		os.Exit(1)
	}
}

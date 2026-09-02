// mcp_probe.go —— the owner actively asking an already-registered external MCP
// server: **do you answer at all, and what tools do you have** (F-D-8)?
//
// Why the implementation lives at the composition root and not in the marketplace
// domain: that server's auth header is ciphertext in the DB, and **the core only
// seals, never unseals** (see the note at the top of unseal.go). The domain declares
// a port (`MCPServerProber`), and this file wires together two things that already
// exist:
//
//   - `dialableMCPServers` (unseal.go) — translates "the stored shape" into "the
//     directly dialable shape";
//   - `mcpclient.Dial` + `ListTools` — the exact path taken when assembling a
//     visitor session (`internal/routes/capload/capreg_ext_mcp.go:149-163`).
//
// So this probe **isn't a newly built outbound path**: it lets the owner manually walk
// the same path session assembly already walks — same shape as the read-only
// connector probe (F-C-16). A card claiming `connected` with no way to actually ask is
// a mistake this product has made before.
//
// (There's a blank line between the block above and `package` because the package
// comment lives in exactly one place, doc.go.)

package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// mcpServerProbe —— implementation of MCPServerProber.
type mcpServerProbe struct {
	servers *dialableMCPServers
}

// probeDialTimeout —— how patient the probe is. The owner is waiting for one line of
// answer, and shouldn't have to wait for the browser to time out; a server that's
// actually answering should finish initialize within a second.
const probeDialTimeout = 12 * time.Second

// Probe —— dial once, list once, hang up. **Keeps no session**: this probe only
// answers a question, it never establishes anything.
func (p *mcpServerProbe) Probe(
	ctx context.Context, ownerID, serverID string,
) (marketplace.MCPProbeResult, error) {
	cfg, err := p.servers.GetByID(ctx, ownerID, serverID)
	if err != nil {
		return marketplace.MCPProbeResult{}, err
	}
	dialCtx, cancel := context.WithTimeout(ctx, probeDialTimeout)
	defer cancel()
	sess, derr := mcpclient.Dial(dialCtx, cfg.URL, cfg.AuthHeader.Headers())
	if derr != nil {
		return marketplace.MCPProbeResult{}, dialFailure(derr)
	}
	defer sess.Close()
	tools, terr := sess.ListTools(dialCtx)
	if terr != nil {
		return marketplace.MCPProbeResult{}, fmt.Errorf("list tools: %w", terr)
	}
	names := make([]string, 0, len(tools))
	for i := range tools {
		names = append(names, tools[i].Name)
	}
	return marketplace.MCPProbeResult{Tools: names}, nil
}

// dialFailure —— translates the transport-layer truth into the two words the domain
// understands (F-D-15).
//
// **The translation lives here because dialing lives here too**: when the domain
// declares its port it's only saying "ask a question" — it shouldn't know about
// `mcpclient`, let alone mcp-go's sentinels. The real cause is still wrapped inside,
// on its way to the log.
func dialFailure(err error) error {
	if errors.Is(err, mcpclient.ErrAuthRejected) {
		return fmt.Errorf("%w: %w", marketplace.ErrMCPServerRefusedAuth, err)
	}
	return fmt.Errorf("%w: %w", marketplace.ErrMCPServerNoAnswer, err)
}

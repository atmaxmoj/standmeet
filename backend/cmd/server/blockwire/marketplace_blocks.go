// marketplace_blocks.go — the block half of the dsh marketplace: search a catalog of
// installable dsh-ecosystem blocks. Install is POST /blocks/install-fixture with
// ecosystem 'marketplace' (mounts the catalog block under OriginMarketplace); uninstall is
// POST /blocks/{id}/uninstall (blocks.delete unregisters it). This lives beside the fixture
// install rather than on /marketplace, whose ops install SKILLS with an incompatible
// response shape — folding blocks onto that route would break the skill marketplace.

package blockwire

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// marketHit — one catalog entry: an install id, the tools it provides, and the seam it
// fills (for the capability filter).
type marketHit struct {
	ID    string   `json:"id"`
	Seam  string   `json:"seam"`
	Tools []string `json:"tools"`
}

// blockCatalog — the installable dsh-ecosystem blocks, mirroring the fixtureBlocks an
// install resolves. Each is installed by id through blocks.install_fixture.
var blockCatalog = []marketHit{
	{ID: "dshecho", Tools: []string{"echo"}, Seam: "tool"},
	{ID: "dshupper", Tools: []string{"echo"}, Seam: "tool"},
}

type marketSearchArgs struct {
	Query string `json:"query"`
	Seam  string `json:"seam"`
}

type marketSearchOut struct {
	Results []marketHit `json:"results"`
}

func searchMarketplaceBlocks(_ *deps.Runtime) fp.Invoke {
	return func(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketSearchArgs
		if uerr := json.Unmarshal(raw, &in); uerr != nil {
			return nil, fp.BadInput("invalid arguments: " + uerr.Error())
		}
		return json.Marshal(marketSearchOut{Results: matchCatalog(in.Query, in.Seam)})
	}
}

// matchCatalog — the catalog entries matching a query (id or tool substring) and, if given,
// a seam filter. An absent query lists everything the seam filter allows; no match is an
// empty list, never an error.
func matchCatalog(query, seam string) []marketHit {
	q := strings.ToLower(strings.TrimSpace(query))
	out := make([]marketHit, 0)
	for i := range blockCatalog {
		if catalogMatch(&blockCatalog[i], q, seam) {
			out = append(out, blockCatalog[i])
		}
	}
	return out
}

// catalogMatch — one entry passes the seam filter (if any) and the query (id / tool
// substring, empty query matches all).
func catalogMatch(h *marketHit, q, seam string) bool {
	if seam != "" && h.Seam != seam {
		return false
	}
	return q == "" || matchesQuery(h, q)
}

func matchesQuery(h *marketHit, q string) bool {
	if strings.Contains(strings.ToLower(h.ID), q) {
		return true
	}
	for _, t := range h.Tools {
		if strings.Contains(strings.ToLower(t), q) {
			return true
		}
	}
	return false
}

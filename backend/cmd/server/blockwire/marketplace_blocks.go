// marketplace_blocks.go — the block half of the dsh marketplace: SEARCH. The npm-backed
// client (discovery + download) lives in the marketplace domain (blockmarket.go); this is the
// thin op that calls it and shapes the result. dsh has no registry of its own — its plugins are
// on npm as @deepseek-ai/cordis-plugin-* / koishi-plugin-*, which the client filters to. Install
// is blocks.marketplace_install (npm_install.go).

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

type marketSearchArgs struct {
	Query string `json:"query"`
}

type marketSearchOut struct {
	Results []marketplace.BlockHit `json:"results"`
}

func searchMarketplaceBlocks(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketSearchArgs
		if uerr := json.Unmarshal(raw, &in); uerr != nil {
			return nil, fp.BadInput("invalid arguments: " + uerr.Error())
		}
		hits, err := d.BlockMarket.Search(ctx, in.Query)
		if err != nil {
			return nil, fp.Upstream("block marketplace search failed: " + err.Error())
		}
		return json.Marshal(marketSearchOut{Results: hits})
	}
}

// corpus_nav.go —— corpus.map / resolve / peek / grep / links on the owner face: the visitor
// tools' navigation, run over the owner's own corpus (see usecase/corpus_owner_nav.go).

package ops

import (
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// navReach —— an AI client's way around the corpus. The admin UI has its own tree and search
// for a person, so these live on the owner MCP face only.
var navReach = fp.Only(
	"navigation for an AI client landing on the corpus; the admin UI is a tree and search for a "+
		"person, it has no use for a map / peek / grep tool", "mcp")

// CorpusNav —— the five navigation ops.
func CorpusNav(deps *usecase.IndexDeps) []fp.Op {
	nav := usecase.OwnerNav(deps)
	out := make([]fp.Op, 0, len(nav))
	for i := range nav {
		out = append(out, fp.Op{
			ID: "corpus." + nav[i].Name, Description: nav[i].Description,
			InputSchema: nav[i].Schema, Kind: fp.Read, Reach: navReach,
			Invoke: fp.Invoke(nav[i].Run),
		})
	}
	return out
}

// corpus_index_deps.go —— host-side deps for corpus indexing (corpus listers) + the scope
// gate. This is the search/navigation interface corpus reaches out with, over its own
// content (search/tree/read) — it's core, and corpus owns it. Consumers (externalized
// sandboxed plugins, e.g. corpus retrieval / conversation summarization) are offline, and
// call back into these corpus_* host ops through a narrow socket bound into the sandbox to
// do the real work (corpus_index_socket.go). The block itself (MCP tool / binding /
// prompt) lives on the plugin side.
//
// corpus's business logic (runSearch/runRead/runList, in visitor_chat*.go) is reused
// unchanged; only the invocation switches from an in-process BindingTool to a socket op
// handler. Citation doesn't go through the block: inference's accumSink accumulates
// {id,genre} directly from corpus_read results (already decoupled, before this change).

package blockload

import (
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// CorpusScopeVisible —— the fragment/enabled gate for the corpus retrieval block:
// active (contributes to the prompt + FiberState.Enabled=true) as long as this
// session's identity **can reach some corpus content**. If it can't reach anything → the
// fragment stays out of the prompt and enabled=false, but the tool is still exposed
// (ACL=always; internal admission is still judged per call). Injected by the composition
// root via CapHooks.Fragment.
//
// The test asks about the scope itself (`ReachesAnything`), not "the allow-list length is
// > 0": a public identity's range is determined by each note's published flag, and it has
// zero globs — judging by length would turn the retrieval block off for every
// codeless visitor.
func CorpusScopeVisible(in *registry.AssembleInput) bool {
	if in.RoleSnapshot == nil {
		return false
	}
	return in.RoleSnapshot.CorpusScope().ReachesAnything()
}

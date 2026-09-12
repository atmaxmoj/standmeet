// register_mechanisms.go —— the four LOADERS a visitor session needs, registered once.
//
// What is here is deliberately not a list of features. Every leaf an owner
// or visitor can name — ask_visitor, summarize, calendar.book, corpus.retrieval — is a
// block: a manifest in `backend/blocks/`, spawned through the transport it declares,
// with no Go written for it anywhere. This file registers the four things that LOAD
// arbitrary others:
//
//	skill runner        runs whatever skill the owner authored
//	ext mcp             dials whatever MCP server the owner registered
//	openapi agent tools exposes whatever operations a connected spec declares
//	resume read         reads whichever application this code is bound to
//
// None of them names a feature, which is why adding a block still costs no code here.
// The distinction is worth holding onto: a file that registers loaders stays four lines
// long forever, and a file that registers features grows by one line per feature — that
// second shape is the star topology, and it is what this design exists to end.

package blockload

import (
	"context"
	"encoding/json"
	"fmt"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// RegisterVisitorSkills —— register the loaders into one session's registry.
//
// Each draws its material from a narrow slice of VisitorSkillsDeps and nothing wider,
// so a loader that is not wired for a given launch is simply absent rather than
// registered-and-broken. The two optional ones are nil-checked for exactly that reason:
// an eval harness with no job loop has no résumés to read, and registering a reader
// with nothing behind it would offer the visitor a tool that always fails.
func RegisterVisitorSkills(
	reg *registry.Registry, deps *conversation.VisitorSkillsDeps, _ conversation.Getter,
) {
	reg.MustRegister(newSkillRunnerFiber(skillRunnerDeps{
		Skills: deps.Skills, Sandbox: deps.Sandbox,
	}))
	reg.MustRegister(NewExtMCPLoader(deps.MCPServers, deps.DepConnected))
	if deps.AgentToolSuppliers != nil {
		reg.MustRegister(newOpenapiAgentToolsFiber(agentToolBridge{deps.AgentToolSuppliers}))
	}
	// Visitor-side résumé reading: a recruiter's session resolves the one application
	// its code was issued against. nil → not exposed, fail-closed the same way as the
	// openapi loader above.
	if deps.Resumes != nil {
		reg.MustRegister(newResumeReadFiber(deps.Resumes))
	}
}

// agentToolBridge —— the conversation domain's agent-tool port, seen as this loader's own.
//
// The two interfaces have the same methods and different owners on purpose: the domain states
// what it needs, the loader states what it consumes, and neither imports the other's shape. This
// file already receives VisitorSkillsDeps from the domain, so the translation costs a few lines
// here rather than a shared type both sides would have to agree on.
type agentToolBridge struct {
	src conversation.AgentToolSupplierSource
}

func (b agentToolBridge) AgentToolSources(
	ctx context.Context, ownerID string,
) ([]AgentToolSource, error) {
	srcs, err := b.src.AgentToolSources(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("agent tool sources: %w", err)
	}
	out := make([]AgentToolSource, 0, len(srcs))
	for _, s := range srcs {
		out = append(out, agentSourceBridge{s})
	}
	return out, nil
}

// agentSourceBridge —— one supplier, with its ops renamed into this package's vocabulary.
type agentSourceBridge struct{ src conversation.AgentToolSource }

func (b agentSourceBridge) AgentOps() []AgentOp {
	ops := b.src.AgentOps()
	out := make([]AgentOp, 0, len(ops))
	for i := range ops {
		out = append(out, AgentOp{
			Name: ops[i].Name, OpID: ops[i].OpID, Description: ops[i].Description,
		})
	}
	return out
}

func (b agentSourceBridge) CallAgentOp(
	ctx context.Context, ownerID, opID string, args json.RawMessage,
) (json.RawMessage, error) {
	out, err := b.src.CallAgentOp(ctx, ownerID, opID, args)
	if err != nil {
		return nil, fmt.Errorf("call agent op: %w", err)
	}
	return out, nil
}

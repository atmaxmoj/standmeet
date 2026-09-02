// capreg_register.go —— Phase B: the builtin registration entry point for capreg.Registry.
// The composition root (cmd/server/boot_wireup.go) calls
// RegisterAgentSkills(reg, &visitor) once, after buildPublicDeps, to register every
// visitor-side builtin capability.
//
// Each B-N appends one line here:
//   B-2: corpus.retrieval (done)
//   B-3: calendar.book / ext.<server> / skill.<name>
//   B-5: job-loop owner-only
//   B-6: MCP parity
//   B-7: resume.read (visitor side; the recruiter reads this one application's résumé by code)

package capload

import (
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
)

// RegisterVisitorSkills —— the registration entry point. Constructs the same set of
// capabilities as prod (newRetrievalCapability / booker / skill-runner / ext-mcp), each
// drawing its material from conversation.VisitorSkillsDeps via its own narrow deps.
//
// The four leaf capabilities (ask_visitor / summarize / calendar.book / corpus.retrieval)
// are now **entirely** externalized as sandboxed plugins (mcp-servers/*), loaded by the
// composition root through the unified sandbox_stdio path with origin=builtin; no
// specific-MCP-capability code remains in the main app at all. The ones that need backend
// data (summarize / booker / retrieval) keep a host socket op (capreg_*_socket.go) instead
// of being registered here as a capability. booker's per-session exposure gate
// (connector+quota) is injected by the composition root as a capreg.SessionGate
// (NewBookerGate).
//
// What's left here is just skill.runner + ext.mcp — they are loaders/mechanisms (loading
// third-party skills / MCP servers), not leaf capabilities, so they aren't externalized.
// sumChats' third parameter is no longer consumed (kept only to preserve the signature).
func RegisterVisitorSkills(
	reg *capreg.Registry, deps *conversation.VisitorSkillsDeps, _ conversation.Getter,
) {
	reg.MustRegister(newSkillRunnerCapability(skillRunnerDeps{
		Skills: deps.Skills, Sandbox: deps.Sandbox,
	}))
	reg.MustRegister(newExtMCPCapability(deps.MCPServers, deps.DepConnected))
	if deps.AgentConnectors != nil {
		reg.MustRegister(newOpenapiAgentToolsCapability(deps.AgentConnectors))
	}
	// Visitor-side résumé reading (B-7): a recruiter session resolves this one application's
	// résumé by code. nil → not exposed (an eval facade / an assembly not wired to job-loop),
	// fail-closed the same way as the openapi one.
	if deps.Resumes != nil {
		reg.MustRegister(newResumeReadCapability(deps.Resumes))
	}
}

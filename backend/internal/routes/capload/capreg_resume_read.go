// capreg_resume_read.go —— the visitor-side résumé-reading capability (in-host, entering
// through the same path as the openapi agent-tools cap).
//
// A recruiter scans the QR code on a résumé → lands in a visitor session opened by a
// hiring code that was auto-issued for an application. This capability lets that session's
// agent read **this one** application's tailored résumé, while none of the conversation /
// access / corpus domains know what a "résumé" is:
//
//   - Discovery: the agent learns this tool exists the same way it learns about any
//     tool — the tool, with its description, entered this session's exposed set. No
//     prompt ever tells it "there is a résumé".
//   - Exposure: only exposed when the subject is a code that can be reverse-resolved to
//     an application (a self-declared gate; ErrHidden self-hides it). An ordinary code,
//     an api-key, or an anonymous session can't see it, so no other layer needs to know
//     résumés exist.
//   - "Which one" and isolation are the same thing. The tool **takes no arguments at
//     all** — the résumé is resolved from the frozen session subject (code → application,
//     held in port.ResumeReader), never from an LLM-supplied parameter. So a session can
//     only ever read its own résumé; reading across sessions has no way to be expressed
//     (see the BOLA lesson in [[owner-scope-not-visitor-scope]]).

package capload

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// ResumeReadTool —— the tool name the recruiter's agent calls.
const ResumeReadTool = "resume_read"

const capResumeReadID = "resume.read"

// resumeReadDesc —— the only signal by which the agent discovers this tool (it's the
// entire hint, in a recruiter session, that "there is a tailored résumé").
const resumeReadDesc = "Read the tailored résumé submitted with the job application whose access " +
	"code opened this chat — the candidate's summary, work history, education, skills, and cover " +
	"letter for the role you are viewing. Takes no arguments; it always returns THIS " +
	"application's résumé."

// resumeArgsSchema —— no parameters: input args cannot change "which one"; resolution
// only ever looks at the session subject.
var resumeArgsSchema = json.RawMessage(`{"type":"object"}`)

// resumeSource —— fetches this application's résumé JSON by the session's access code.
// err → fail-closed hidden (an ordinary code has no bound application, or a real failure).
// Satisfied by the composition root's port.ResumeReader.
type resumeSource interface {
	ResumeForCode(ctx context.Context, ownerID, codeID string) ([]byte, error)
}

type resumeReadCapability struct {
	src resumeSource
}

func newResumeReadCapability(src resumeSource) *resumeReadCapability {
	return &resumeReadCapability{src: src}
}

var _ capreg.Capability = (*resumeReadCapability)(nil)

func (*resumeReadCapability) ID() string { return capResumeReadID }

func (*resumeReadCapability) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (*resumeReadCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (*resumeReadCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*resumeReadCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— a self-declared gate: the résumé tool is exposed only when the subject
// is a code that resolves to an application; every other case → ErrHidden (a clean hide —
// the tool simply never appears, and no other layer needs to know résumés exist).
func (c *resumeReadCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	content, ok := c.resolve(ctx, in)
	if !ok {
		return nil, capreg.ErrHidden
	}
	return &capreg.Binding{
		Tools: []capreg.BindingTool{capreg.NewTool(
			ResumeReadTool, resumeReadDesc, "", resumeArgsSchema, resumeRunFn(content),
		)},
		State: capreg.CapabilityState{ID: capResumeReadID, Enabled: true},
	}, nil
}

// resolve —— (content, true) when the session's code resolves to a résumé; otherwise
// (nil, false), hidden.
func (c *resumeReadCapability) resolve(
	ctx context.Context, in *capreg.AssembleInput,
) ([]byte, bool) {
	codeID, ok := codeSubjectID(in)
	if !ok {
		return []byte{}, false
	}
	return c.fetch(ctx, in.OwnerID, codeID)
}

// fetch —— gets the résumé bound to this code. fail-closed: both not-found and a real
// error are hidden — when unsure, never expose a tool that can read a private résumé.
func (c *resumeReadCapability) fetch(
	ctx context.Context, ownerID, codeID string,
) ([]byte, bool) {
	content, err := c.src.ResumeForCode(ctx, ownerID, codeID)
	if err != nil {
		return []byte{}, false
	}
	return content, true
}

// codeSubjectID —— the session subject is a non-empty code → (code-id, true); otherwise
// ("", false). api-key / anonymous (empty id) → false, and the résumé tool hides on that.
func codeSubjectID(in *capreg.AssembleInput) (string, bool) {
	if in == nil || in.Subject.Kind != capreg.SubjectCode {
		return "", false
	}
	return in.Subject.ID, in.Subject.ID != ""
}

// resumeRunFn —— the tool handler. Ignores args entirely: the résumé was already fixed
// from the session subject at bind time, so an LLM stuffing another application's id into
// the parameters cannot change what's returned.
func resumeRunFn(content []byte) capreg.RunFn {
	return func(_ context.Context, _ string) (string, error) {
		return string(content), nil
	}
}

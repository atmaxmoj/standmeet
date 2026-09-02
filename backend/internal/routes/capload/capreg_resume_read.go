// capreg_resume_read.go —— 访客侧的简历读取能力（in-host，跟 openapi agent-tools cap 同一条进法）。
//
// 招聘官扫简历上的 QR → 落进一个用 application 自动签发的 hiring 码开的访客会话。这个能力让那个
// 会话的 agent 读到**这一份** application 的定制简历，而 conversation / access / corpus 三个域都
// 不认识"简历"这回事：
//
//   - 发现：agent 知道这个工具存在，跟它知道任何工具一样 —— 工具带着描述进了本会话的 exposed set。
//     没有任何 prompt 告诉它"有简历"。
//   - 暴露：只在 subject 是一张能反查到 application 的 code 时暴露（自声明 gate，ErrHidden 自隐藏）。
//     普通码、api-key、匿名会话都看不到它，于是别的层不必知道简历存在。
//   - "哪一份"+隔离：是同一件事。工具**不接受任何入参** —— 简历从冻结的 session subject 反查
//     （code → application，收在 port.ResumeReader 里），不从 LLM 递来的参数取。于是一个会话只
//     可能读到它自己那份，跨会话读取无法表达（见 [[owner-scope-not-visitor-scope]] 的 BOLA 教训）。

package capload

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// ResumeReadTool —— 招聘官 agent 调的工具名。
const ResumeReadTool = "resume_read"

const capResumeReadID = "resume.read"

// resumeReadDesc —— agent 发现这个工具的唯一信号（它是招聘官会话里"有一份定制简历"的全部提示）。
const resumeReadDesc = "Read the tailored résumé submitted with the job application whose access " +
	"code opened this chat — the candidate's summary, work history, education, skills, and cover " +
	"letter for the role you are viewing. Takes no arguments; it always returns THIS " +
	"application's résumé."

// resumeArgsSchema —— 无参数：入参改变不了"哪一份"，解析只认 session subject。
var resumeArgsSchema = json.RawMessage(`{"type":"object"}`)

// resumeSource —— 按 session 的 access code 取这一份 application 的简历 JSON。err → fail-closed
// 隐藏（普通码没绑 application、或真失败）。由 composition root 的 port.ResumeReader 满足。
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

// VisitorBinding —— 自声明 gate：subject 是一张能反查到 application 的 code 才暴露简历工具；
// 其余一律 ErrHidden（干净隐藏 —— 工具根本不出现，别的层无需知道简历存在）。
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

// resolve —— (content, true) 当会话的码反查得到一份简历；否则 (nil, false) 隐藏。
func (c *resumeReadCapability) resolve(
	ctx context.Context, in *capreg.AssembleInput,
) ([]byte, bool) {
	codeID, ok := codeSubjectID(in)
	if !ok {
		return []byte{}, false
	}
	return c.fetch(ctx, in.OwnerID, codeID)
}

// fetch —— 拿这张码绑的简历。fail-closed：not-found 和真错误都隐藏 —— 拿不准就不暴露一个
// 能读私有简历的工具。
func (c *resumeReadCapability) fetch(
	ctx context.Context, ownerID, codeID string,
) ([]byte, bool) {
	content, err := c.src.ResumeForCode(ctx, ownerID, codeID)
	if err != nil {
		return []byte{}, false
	}
	return content, true
}

// codeSubjectID —— session subject 是一张非空 code → (code-id, true)；否则 ("", false)。
// api-key / 匿名(空 id) → false，简历工具据此隐藏。
func codeSubjectID(in *capreg.AssembleInput) (string, bool) {
	if in == nil || in.Subject.Kind != capreg.SubjectCode {
		return "", false
	}
	return in.Subject.ID, in.Subject.ID != ""
}

// resumeRunFn —— 工具 handler。完全忽略 args：简历在 bind 时已从 session subject 定死，
// LLM 参数里塞另一份 application 的 id 也改不了返回的内容。
func resumeRunFn(content []byte) capreg.RunFn {
	return func(_ context.Context, _ string) (string, error) {
		return string(content), nil
	}
}

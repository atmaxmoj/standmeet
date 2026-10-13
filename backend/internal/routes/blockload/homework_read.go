// homework_read.go —— the recruiter's second view of THIS application, served by the same fiber as
// the résumé (resume_read.go): the homework the owner did on its job — what they learned about the
// company and team, and why they fit. Offered only when there is homework; no arguments, the
// content fixed from the frozen session subject, exactly like the résumé.

package blockload

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// HomeworkReadTool —— the tool name the recruiter's agent calls.
const HomeworkReadTool = "homework_read"

const homeworkReadDesc = "Read the homework the candidate did on the job whose access code " +
	"opened this chat: what they learned about your company and team, and why they think they " +
	"fit. Takes no arguments; it always returns THIS application's homework."

var homeworkArgsSchema = json.RawMessage(`{"type":"object"}`)

type homeworkSource interface {
	HomeworkForCode(ctx context.Context, ownerID, codeID string) (string, error)
}

// noHomework —— the source when none is wired: never any homework.
type noHomework struct{}

func (noHomework) HomeworkForCode(context.Context, string, string) (string, error) {
	return "", nil
}

// withHomework —— the fiber also offers homework_read (nil source: it never does).
func (c *resumeReadFiber) withHomework(src homeworkSource) *resumeReadFiber {
	if src != nil {
		c.homework = src
	}
	return c
}

// homeworkTools —— the homework tool for this code's application; none when there is no homework
// (or a lookup failure: fail-closed).
func (c *resumeReadFiber) homeworkTools(
	ctx context.Context, ownerID, codeID string,
) []registry.BindingTool {
	text, err := c.homework.HomeworkForCode(ctx, ownerID, codeID)
	if err != nil || text == "" {
		return []registry.BindingTool{}
	}
	return []registry.BindingTool{registry.NewTool(
		HomeworkReadTool, homeworkReadDesc, "", homeworkArgsSchema, homeworkRunFn(text),
	)}
}

// homeworkRunFn —— ignores args: the homework was fixed from the session subject at bind time.
func homeworkRunFn(text string) registry.RunFn {
	return func(_ context.Context, _ string) (string, error) {
		return text, nil
	}
}

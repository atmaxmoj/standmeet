// visitor_code_prompt.go —— 一张 access code 带来的那段 prompt 怎么取。
//
// 从 visitor_role_snapshot.go 拆出来：那个文件是 snapshot 的**装配**，而这里是
// 一条取值规则，而且这条规则自己有故事（下面那段），值得一个自己的地方。

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// resolveCodePrompt —— 两层**叠加**，不是二选一。
//
// 它们是不同的层，不是同一件事的两种写法：
//   - prompt_id  = owner 集中管理的、这一类访客通用的那份（改一次，所有还没被打开的码受益）
//   - inline     = 发码方随**这一张**码带的那句（"这是冲着 GitLab Staff Backend 来的"）
//
// 曾经是 `inline 非空就赢`。而 job loop 两样都要：招聘语境**和**这一份是哪个职位。
// 互斥逼它二选一，于是自动签的码要么没有招聘语境、要么不知道自己是哪个职位 ——
// 那个"要么"本身就是缺陷。role persona 和 code prompt 早就是叠加的，这里同理。
//
// 叠加的顺序有意义：通用的在前、这一张码专属的在后。后面那句是对前面的**收窄**，
// 反过来的话具体的会被通用的盖住。
func resolveCodePrompt(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
) (string, error) {
	shared, err := promptBodyByID(ctx, deps, code.OwnerID, code.PromptID)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(strings.Join(
		nonEmptyParts(shared, code.InlinePrompt), "\n\n",
	)), nil
}

// nonEmptyParts —— 拼接前先把空的挑掉，免得留下一串空行。
func nonEmptyParts(parts ...string) []string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

// promptBodyByID —— 按可选 prompt id 取 body（role prompt + per-code prompt 共用）。
// nil / 不存在（SET NULL 删过）→ 空串（那段 persona 没有，session 照常）。
func promptBodyByID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, promptID *string,
) (string, error) {
	if promptID == nil {
		return "", nil
	}
	prompt, err := deps.Prompts.GetByID(ctx, ownerID, *promptID)
	if err != nil {
		if errors.Is(err, owner.ErrPromptNotFound) {
			return "", nil
		}
		return "", fmt.Errorf("get prompt for snapshot: %w", err)
	}
	return prompt.Body(), nil
}

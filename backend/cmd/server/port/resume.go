// resume.go —— composition root 把 job-loop 的 ApplicationRepo 适配成访客侧简历读取能力的窄口。
// 这个能力只需要"按 access code 取这一份简历的 JSON"，不该依赖整个 ApplicationRepo，
// conversation / capload 更不该认识 jobsmodel —— 序列化收在这一层。
//
// not-found（普通码没绑 application）跟真失败一样返回 error：capability 拿到 error 一律隐藏
// （fail-closed），不必分辨两者，所以这里不为它单开一条返回路径。

package port

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// ResumesByCode —— 构造。返回一个只能"按 access code 取这一份简历 JSON"的口子。
func ResumesByCode(d *deps.Runtime) ResumeReader {
	return ResumeReader{repo: d.ApplicationRepo}
}

// ResumeReader —— 导出（revive unexported-return）。满足 conversation.ResumeSource。
type ResumeReader struct{ repo *jobsuc.ApplicationRepo }

// ResumeForCode —— 反查这张 access code 绑的 application，回它的 resume_content（JSON bytes）。
// 没绑 application 的普通码 → GetByAccessCode 返 ErrApplicationNotFound，这里包成 error 上抛
// （capability 据此隐藏工具）。
func (r ResumeReader) ResumeForCode(
	ctx context.Context, ownerID, codeID string,
) ([]byte, error) {
	app, err := r.repo.GetByAccessCode(ctx, ownerID, codeID)
	if err != nil {
		return []byte{}, fmt.Errorf("resume for code: %w", err)
	}
	out, merr := json.Marshal(app.ResumeContent)
	if merr != nil {
		return []byte{}, fmt.Errorf("marshal resume content: %w", merr)
	}
	return out, nil
}

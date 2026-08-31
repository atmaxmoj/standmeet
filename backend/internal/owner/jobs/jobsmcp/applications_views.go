// applications_views.go —— applications.commit tool 响应中 text 部分的 JSON 形状。

package jobsmcp

import "github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"

// committedApplicationViewT —— commit 返回 text 部分。PDF 走 EmbeddedResource。
//
// access_code 是 plaintext —— recruiter 扫 QR 进 visitor chat 时携带的就是这个，
// 但 owner 也可以直接复制 QRURL 共享。
//
// next_action 是 Phase 4 决定：不做独立的 "submit" MCP tool（Playwright MCP
// 是 owner-side install 的）—— 而是在 commit 响应里塞一个结构化 hint，让
// Claude 看完就知道下一步要驱动本地 Playwright MCP 去填表 + 上传 PDF。
type committedApplicationViewT struct {
	NextAction    submissionHint `json:"next_action"`
	ApplicationID string         `json:"application_id"`
	AccessCodeID  string         `json:"access_code_id"`
	AccessCode    string         `json:"access_code"`
	QRURL         string         `json:"qr_url"`
	Status        string         `json:"status"`
	CreatedAt     string         `json:"created_at"`
	CodeExpiresAt string         `json:"code_expires_at,omitempty"`
	// Warning —— 投出去了，但有件事 owner 该知道（omitempty：没有就不出现）。
	Warning string `json:"warning,omitempty"`
	// JobSnapshot 放末位：govet fieldalignment（它是这一堆里最大的那个）。
	JobSnapshot fetchedJobView `json:"job_snapshot"`
}

// submissionHint —— Phase 4 next-step contract。Claude 读 type='submit_via_playwright'
// 就知道去调本地装的 Playwright MCP；target_url 是 JD 投递页；attachment_uri
// 指向同响应里的 PDF EmbeddedResource（standmeet://application/<id>）；fill_fields
// 把 resume_content.identity 抽出来给表单填写做参考。
type submissionHint struct {
	FillFields    map[string]string `json:"fill_fields"`
	Type          string            `json:"type"`
	TargetURL     string            `json:"target_url"`
	AttachmentURI string            `json:"attachment_uri"`
	Instructions  string            `json:"instructions"`
}

const submissionInstructions = "Use the locally-installed Playwright MCP " +
	"(e.g. @playwright/mcp) to: (1) browser_navigate to target_url; (2) locate " +
	"the resume upload field and attach the PDF from attachment_uri (decode " +
	"the embedded base64 blob to a temp file); (3) fill identity fields from " +
	"fill_fields where the form asks; (4) submit. The QR printed on the PDF " +
	"(qr_url, top-right corner) routes the recruiter straight to visitor chat."

func committedApplicationView(c *jobsmodel.CommittedApplication) committedApplicationViewT {
	v := committedApplicationViewT{
		ApplicationID: c.Application.ID,
		AccessCodeID:  c.AccessCode.ID,
		AccessCode:    c.AccessCode.Code,
		QRURL:         c.QRURL,
		Status:        c.Application.Status,
		CreatedAt:     c.Application.CreatedAt.Format(mcpTimeFmt),
		JobSnapshot:   fetchedJobToView(&c.Application.JobSnapshot),
		NextAction:    buildSubmissionHint(c),
		Warning:       c.Warning,
	}
	if c.AccessCode.ExpiresAt != nil {
		v.CodeExpiresAt = c.AccessCode.ExpiresAt.Format(mcpTimeFmt)
	}
	return v
}

func buildSubmissionHint(c *jobsmodel.CommittedApplication) submissionHint {
	id := &c.Application.ResumeContent.Identity
	fill := map[string]string{}
	if id.Name != "" {
		fill["name"] = id.Name
	}
	if id.Email != "" {
		fill["email"] = id.Email
	}
	if id.Phone != "" {
		fill["phone"] = id.Phone
	}
	if id.LocationLine != "" {
		fill["location"] = id.LocationLine
	}
	return submissionHint{
		Type:          "submit_via_playwright",
		TargetURL:     c.Application.JobSnapshot.URL,
		AttachmentURI: applicationCapURIScheme + c.Application.ID,
		FillFields:    fill,
		Instructions:  submissionInstructions,
	}
}

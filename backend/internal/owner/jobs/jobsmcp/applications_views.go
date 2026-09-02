// applications_views.go —— the JSON shape of the text part in the
// applications.commit tool response.

package jobsmcp

import "github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"

// committedApplicationViewT —— the text part of the commit response. The
// PDF travels as an EmbeddedResource instead.
//
// access_code is plaintext — it's what the recruiter carries in when they
// scan the QR into visitor chat, but the owner can also just copy QRURL
// to share directly.
//
// next_action is a Phase 4 decision: instead of a standalone "submit" MCP
// tool (Playwright MCP is an owner-side install), the commit response
// carries a structured hint, so Claude reads it and knows the next step
// is to drive the local Playwright MCP to fill the form and upload the PDF.
type committedApplicationViewT struct {
	NextAction    submissionHint `json:"next_action"`
	ApplicationID string         `json:"application_id"`
	AccessCodeID  string         `json:"access_code_id"`
	AccessCode    string         `json:"access_code"`
	QRURL         string         `json:"qr_url"`
	Status        string         `json:"status"`
	CreatedAt     string         `json:"created_at"`
	CodeExpiresAt string         `json:"code_expires_at,omitempty"`
	// Warning —— the application went out, but there's something the owner
	// should know (omitempty: absent when there's nothing to say).
	Warning string `json:"warning,omitempty"`
	// JobSnapshot goes last: govet fieldalignment (it's the biggest field here).
	JobSnapshot fetchedJobView `json:"job_snapshot"`
}

// submissionHint —— the Phase 4 next-step contract. Claude reads
// type='submit_via_playwright' and knows to call the locally-installed
// Playwright MCP; target_url is the JD's application page; attachment_uri
// points at the PDF EmbeddedResource in the same response
// (standmeet://application/<id>); fill_fields pulls resume_content.identity
// out as reference for filling the form.
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

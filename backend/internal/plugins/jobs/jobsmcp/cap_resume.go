// cap_resume.go —— Phase E-11: owner-side resume.* Capability。
// 3 tools: draft / update_draft / discard_draft。owner-only。
//
// draft / update_draft 返 text-only JSON (draft id + job_snapshot 等)；
// PDF 不在这里。终稿 PDF (带真 AccessCode QR) 走 applications.commit
// 的 EmbeddedResource。draft 24h TTL，跟 job cache 同步。

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
)

const capResumeBundle = "resume.bundle"

type resumeCapability struct {
	resume *jobsuc.ResumeDeps
	log    *slog.Logger
}

// NewResumeCapability —— J.3 起外露给 internal/mcp/register.go。
func NewResumeCapability(
	resume *jobsuc.ResumeDeps, log *slog.Logger,
) capreg.Capability {
	return &resumeCapability{resume: resume, log: log}
}

func (*resumeCapability) ID() string          { return capResumeBundle }
func (*resumeCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*resumeCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*resumeCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*resumeCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *resumeCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.draftBinding(), c.updateDraftBinding(), c.discardDraftBinding(),
	}
}

// ───── resume.draft ─────────────────────────────────────────────

func (c *resumeCapability) draftBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "resume.draft",
		Description: "Curate a tailored resume for a cached job and stash it as a " +
			"draft. Returns draft_id plus job_snapshot. Owner opens admin preview " +
			"at /admin/drafts/<id>. Final PDF (with real recruiter QR) is rendered " +
			"by applications.commit. Draft TTL = 24h.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"job_cache_id":{"type":"string","description":"cache_id from jobs.fetch_new"},
				"resume_content":{"type":"object",
					"description":"Structured resume content."}
			},
			"required":["job_cache_id","resume_content"]
		}`),
		Handler: c.handleDraft,
	}
}

type resumeDraftArgsWire struct {
	ResumeContent *jobsmodel.ResumeContent `json:"resume_content"`
	JobCacheID    string                   `json:"job_cache_id"`
}

func (c *resumeCapability) handleDraft(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args resumeDraftArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.JobCacheID == "" {
		return capreg.MCPError("job_cache_id is required")
	}
	if args.ResumeContent == nil {
		return capreg.MCPError("resume_content is required")
	}
	drafted, err := jobsuc.DraftResume(
		ctx, *c.resume, ownerID, args.JobCacheID, args.ResumeContent,
	)
	if err != nil {
		return resumeCapErrToResult(c.log, err, "draft")
	}
	return mcputil.MarshalResult(c.log, "resume.draft", resumeDraftView(&drafted.Draft))
}

// ───── resume.update_draft ────────────────────────────────────

func (c *resumeCapability) updateDraftBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "resume.update_draft",
		Description: "Replace the structured content of an existing draft. " +
			"job_snapshot is preserved.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"draft_id":{"type":"string","description":"draft id from resume.draft"},
				"resume_content":{"type":"object",
					"description":"New structured resume content (replaces previous)."}
			},
			"required":["draft_id","resume_content"]
		}`),
		Handler: c.handleUpdateDraft,
	}
}

type resumeUpdateArgsWire struct {
	ResumeContent *jobsmodel.ResumeContent `json:"resume_content"`
	DraftID       string                   `json:"draft_id"`
}

func (c *resumeCapability) handleUpdateDraft(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args resumeUpdateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.DraftID == "" {
		return capreg.MCPError("draft_id is required")
	}
	if args.ResumeContent == nil {
		return capreg.MCPError("resume_content is required")
	}
	drafted, err := jobsuc.UpdateResumeDraft(
		ctx, *c.resume, ownerID, args.DraftID, args.ResumeContent,
	)
	if err != nil {
		return resumeCapErrToResult(c.log, err, "update_draft")
	}
	return mcputil.MarshalResult(c.log, "resume.update_draft",
		resumeDraftView(&drafted.Draft))
}

// ───── resume.discard_draft ───────────────────────────────────

func (c *resumeCapability) discardDraftBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "resume.discard_draft",
		Description: "Delete a draft (idempotent — unknown / wrong-owner / " +
			"already-deleted all succeed).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"draft_id":{"type":"string","description":"draft id"}
			},
			"required":["draft_id"]
		}`),
		Handler: c.handleDiscardDraft,
	}
}

type resumeDiscardArgsWire struct {
	DraftID string `json:"draft_id"`
}

func (c *resumeCapability) handleDiscardDraft(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args resumeDiscardArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.DraftID == "" {
		return capreg.MCPError("draft_id is required")
	}
	if err := jobsuc.DiscardResumeDraft(ctx, *c.resume, ownerID, args.DraftID); err != nil {
		return resumeCapErrToResult(c.log, err, "discard_draft")
	}
	return mcputil.MarshalResult(c.log, "resume.discard_draft", map[string]bool{"ok": true})
}

// ───── error mapping ──────────────────────────────────────────

func resumeCapErrToResult(log *slog.Logger, err error, op string) capreg.MCPResult {
	if msg, ok := resumeCapClientErr(err); ok {
		return capreg.MCPError(msg)
	}
	log.Error("cap resume."+op, "err", err)
	return capreg.MCPError("resume." + op + " failed")
}

func resumeCapClientErr(err error) (string, bool) {
	switch {
	case errors.Is(err, jobsmodel.ErrJobCacheMiss):
		return "job cache miss (expired or never existed)", true
	case errors.Is(err, jobsmodel.ErrResumeDraftNotFound):
		return "draft not found (expired or wrong owner)", true
	case errors.Is(err, jobsmodel.ErrResumeContentInvalid):
		return "resume_content invalid: " + err.Error(), true
	}
	return "", false
}

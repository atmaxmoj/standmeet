// fiber_resume.go —— Phase E-11: the owner-side resume.* fiber.
// 3 tools: draft / update_draft / discard_draft. owner-only.
//
// draft / update_draft return text-only JSON (draft id + job_snapshot etc.);
// the PDF isn't here. The final PDF (with the real AccessCode QR) travels
// as applications.commit's EmbeddedResource. Draft TTL is 24h, in sync
// with the job cache.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

const resumeBundleID = "resume.bundle"

type resumeFiber struct {
	resume *jobsuc.ResumeDeps
	log    *slog.Logger
}

// NewResumeFiber —— exposed to the composition root as of J.3.
func NewResumeFiber(
	resume *jobsuc.ResumeDeps, log *slog.Logger,
) registry.Fiber {
	return &resumeFiber{resume: resume, log: log}
}

func (*resumeFiber) ID() string            { return resumeBundleID }
func (*resumeFiber) Shape() registry.Shape { return registry.ShapeOwnerOnly }
func (*resumeFiber) VisitorBinding(
	_ context.Context, _ *registry.AssembleInput,
) (*registry.Binding, error) {
	return nil, registry.ErrHidden
}

func (*resumeFiber) SystemPromptFragment(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (*resumeFiber) SystemPromptFragmentID(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (c *resumeFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return append([]*registry.MCPBinding{
		c.draftBinding(), c.updateDraftBinding(), c.discardDraftBinding(),
	}, c.masterBindings()...)
}

// ───── resume.draft ─────────────────────────────────────────────

func (c *resumeFiber) draftBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name: "resume.draft", Danger: "write",
		// The phrase "preview at /admin/drafts/<id>" used to be a dead link:
		// a draft has no route of its own, the composer is a button on the
		// list page. The owner's AI would copy that phrase verbatim and
		// send the owner there (F-E-8).
		Description: "Curate a tailored resume for a cached job and stash it as a " +
			"draft. Start from a résumé master with master_id (see resume.master_list): " +
			"without resume_content the draft copies the master's content. Returns draft_id, " +
			"job_snapshot and resume_content. Owner reviews it at " +
			"/admin/drafts — the draft's card there opens the composer (edit + live " +
			"PDF preview). Final PDF (with real recruiter QR) is rendered " +
			"by applications.commit. Draft TTL = 24h.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"job_cache_id":{"type":"string","description":"cache_id from jobs.fetch_new"},
				"resume_content":{"type":"object",
					"description":"Structured resume content. Optional when master_id is given."},
				"master_id":{"type":"string",
					"description":"The master this draft starts from (its based_on)."},
				"template":{"type":"string",
					"description":"Layout: 'classic' or 'compact' (ATS). Empty=classic."}
			},
			"required":["job_cache_id"]
		}`),
		Handler: c.handleDraft,
	}
}

type resumeDraftArgsWire struct {
	ResumeContent *jobsmodel.ResumeContent `json:"resume_content"`
	JobCacheID    string                   `json:"job_cache_id"`
	Template      string                   `json:"template"`
	MasterID      string                   `json:"master_id"`
}

func (c *resumeFiber) handleDraft(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args resumeDraftArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	drafted, err := jobsuc.DraftResume(ctx, *c.resume, ownerID, jobsuc.DraftInput{
		Content: args.ResumeContent, JobCacheID: args.JobCacheID, Template: args.Template,
		MasterID: args.MasterID,
	})
	if err != nil {
		return resumeCapErrToResult(c.log, err, "draft")
	}
	return mcputil.MarshalResult(c.log, "resume.draft", resumeDraftView(&drafted.Draft))
}

// ───── resume.update_draft ────────────────────────────────────

func (c *resumeFiber) updateDraftBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name: "resume.update_draft", Danger: "write",
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

func (c *resumeFiber) handleUpdateDraft(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args resumeUpdateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if args.DraftID == "" {
		return registry.MCPError("draft_id is required")
	}
	if args.ResumeContent == nil {
		return registry.MCPError("resume_content is required")
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

func (c *resumeFiber) discardDraftBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
		Name: "resume.discard_draft", Danger: "destructive",
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

func (c *resumeFiber) handleDiscardDraft(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args resumeDiscardArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if args.DraftID == "" {
		return registry.MCPError("draft_id is required")
	}
	if err := jobsuc.DiscardResumeDraft(ctx, *c.resume, ownerID, args.DraftID); err != nil {
		return resumeCapErrToResult(c.log, err, "discard_draft")
	}
	return mcputil.MarshalResult(c.log, "resume.discard_draft", map[string]bool{"ok": true})
}

// ───── error mapping ──────────────────────────────────────────

func resumeCapErrToResult(log *slog.Logger, err error, op string) registry.MCPResult {
	if msg, ok := resumeCapClientErr(err); ok {
		return registry.MCPError(msg)
	}
	log.Error("cap resume."+op, "err", err)
	return registry.MCPError("resume." + op + " failed")
}

// resumeClientErrs —— the errors the caller can act on, and what to tell it.
var resumeClientErrs = []struct {
	err error
	msg string
}{
	{jobsmodel.ErrJobCacheMiss, "job cache miss (expired or never existed)"},
	{jobsmodel.ErrResumeDraftNotFound, "draft not found (expired or wrong owner)"},
	{jobsmodel.ErrResumeContentInvalid, "resume_content invalid"},
	{jobsmodel.ErrResumeMasterNotFound, "master not found (wrong id or owner)"},
	{jobsmodel.ErrResumeMasterNameRequired, "name is required"},
	{jobsmodel.ErrResumeDraftIncomplete, jobsmodel.ErrResumeDraftIncomplete.Error()},
}

func resumeCapClientErr(err error) (string, bool) {
	for _, e := range resumeClientErrs {
		if errors.Is(err, e.err) {
			return e.msg, true
		}
	}
	return "", false
}

// cap_applications.go —— Phase E-12: applications.commit Capability。
// owner-only。返 [text(JSON), embed(PDF blob)] 多 content; PDF gotenberg
// 抓 admin /print 路由跟 owner live preview 像素一致 (见 docs/design/job-loop.md)。
//
// MCPResult.Embeddings (Phase E-12 扩) 让 adapter 把 PDF blob 一起塞进
// CallToolResult.Content[]。

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/jobsdomain"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
)

const (
	capApplicationsBundle   = "applications.bundle"
	applicationMIMEPDF      = "application/pdf"
	applicationCapURIScheme = "standmeet://application/"
)

type applicationsCapability struct {
	apps *jobsuc.ApplicationsDeps
	log  *slog.Logger
}

// NewApplicationsCapability —— J.3 起外露给 internal/mcp/register.go。
func NewApplicationsCapability(
	apps *jobsuc.ApplicationsDeps, log *slog.Logger,
) capreg.Capability {
	return &applicationsCapability{apps: apps, log: log}
}

func (*applicationsCapability) ID() string          { return capApplicationsBundle }
func (*applicationsCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*applicationsCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*applicationsCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*applicationsCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *applicationsCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.commitBinding()}
}

// ───── applications.commit ──────────────────────────────────────

func (c *applicationsCapability) commitBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "applications.commit",
		Description: "Promote a resume draft to a persistent application: atomically " +
			"issues a 180-day AccessCode (10 sessions / 50 turns per member), writes " +
			"the application row, and deletes the draft. Returns application_id, the " +
			"plaintext access_code, the QR URL printed on the resume, and the final " +
			"PDF (base64) ready for Playwright submission.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"draft_id":{"type":"string","description":"draft id from resume.draft"}
			},
			"required":["draft_id"]
		}`),
		Handler: c.handleCommit,
	}
}

type commitArgsWire struct {
	DraftID string `json:"draft_id"`
}

func (c *applicationsCapability) handleCommit(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args commitArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.DraftID == "" {
		return capreg.MCPError("draft_id is required")
	}
	committed, err := jobsuc.CommitApplication(ctx, *c.apps, ownerID, args.DraftID)
	if err != nil {
		return applicationsCapErrToResult(c.log, err, "commit")
	}
	return buildCommitResult(c.log, &committed)
}

func buildCommitResult(
	log *slog.Logger, committed *jobsdomain.CommittedApplication,
) capreg.MCPResult {
	view := committedApplicationView(committed)
	jsonBytes, err := json.Marshal(view)
	if err != nil {
		log.Error("cap applications.commit marshal view", "err", err)
		return capreg.MCPError("encode view: " + err.Error())
	}
	return capreg.MCPSuccessWithEmbeddings(
		string(jsonBytes),
		[]capreg.MCPEmbedded{{
			URI:      applicationCapURIScheme + committed.Application.ID,
			MIMEType: applicationMIMEPDF,
			Blob:     committed.PDF,
		}},
	)
}

// ───── error mapping ────────────────────────────────────────────

func applicationsCapErrToResult(
	log *slog.Logger, err error, op string,
) capreg.MCPResult {
	switch {
	case errors.Is(err, jobsdomain.ErrResumeDraftNotFound):
		return capreg.MCPError("draft not found (expired or wrong owner)")
	case errors.Is(err, jobsdomain.ErrApplicationNotFound):
		return capreg.MCPError("application not found")
	case errors.Is(err, domain.ErrOwnerNotFound):
		return capreg.MCPError("owner not found")
	}
	log.Error("cap applications."+op, "err", err)
	return capreg.MCPError("applications." + op + " failed")
}

// fiber_applications.go —— Phase E-12: the applications.commit fiber.
// owner-only. Returns multi-content [text(JSON), embed(PDF blob)]; the PDF
// is rendered by gotenberg hitting the admin /print route, pixel-identical
// to the owner's live preview (see docs/design/job-loop.md).
//
// MCPResult.Embeddings (a Phase E-12 extension) lets the adapter fold the
// PDF blob into CallToolResult.Content[] alongside the text.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

const (
	applicationsBundleID = "applications.bundle"
	applicationMIMEPDF   = "application/pdf"
	applicationURIScheme = "standmeet://application/"
)

type applicationsFiber struct {
	apps *jobsuc.ApplicationsDeps
	log  *slog.Logger
}

// NewApplicationsFiber —— exposed to the composition root as of J.3.
func NewApplicationsFiber(
	apps *jobsuc.ApplicationsDeps, log *slog.Logger,
) registry.Fiber {
	return &applicationsFiber{apps: apps, log: log}
}

func (*applicationsFiber) ID() string            { return applicationsBundleID }
func (*applicationsFiber) Shape() registry.Shape { return registry.ShapeOwnerOnly }
func (*applicationsFiber) VisitorBinding(
	_ context.Context, _ *registry.AssembleInput,
) (*registry.Binding, error) {
	return nil, registry.ErrHidden
}

func (*applicationsFiber) SystemPromptFragment(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (*applicationsFiber) SystemPromptFragmentID(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (c *applicationsFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{c.commitBinding()}
}

// ───── applications.commit ──────────────────────────────────────

func (c *applicationsFiber) commitBinding() *registry.MCPBinding {
	return &registry.MCPBinding{
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

func (c *applicationsFiber) handleCommit(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var args commitArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if args.DraftID == "" {
		return registry.MCPError("draft_id is required")
	}
	committed, err := jobsuc.CommitApplication(
		ctx, c.apps, ownerID, args.DraftID, jobsuc.CommitOptions{},
	)
	if err != nil {
		return applicationsCapErrToResult(c.log, err, "commit")
	}
	return buildCommitResult(c.log, &committed)
}

func buildCommitResult(
	log *slog.Logger, committed *jobsmodel.CommittedApplication,
) registry.MCPResult {
	view := committedApplicationView(committed)
	jsonBytes, err := json.Marshal(view)
	if err != nil {
		log.Error("cap applications.commit marshal view", "err", err)
		return registry.MCPError("encode view: " + err.Error())
	}
	return registry.MCPSuccessWithEmbeddings(
		string(jsonBytes),
		[]registry.MCPEmbedded{{
			URI:      applicationURIScheme + committed.Application.ID,
			MIMEType: applicationMIMEPDF,
			Blob:     committed.PDF,
		}},
	)
}

// ───── error mapping ────────────────────────────────────────────

func applicationsCapErrToResult(
	log *slog.Logger, err error, op string,
) registry.MCPResult {
	switch {
	case errors.Is(err, jobsmodel.ErrResumeDraftNotFound):
		return registry.MCPError("draft not found (expired or wrong owner)")
	case errors.Is(err, jobsmodel.ErrApplicationNotFound):
		return registry.MCPError("application not found")
	case errors.Is(err, owner.ErrOwnerNotFound):
		return registry.MCPError("owner not found")
	}
	log.Error("cap applications."+op, "err", err)
	return registry.MCPError("applications." + op + " failed")
}

// fiber_applications.go —— applications.commit, a dispatcher op (refactor ledger R2;
// docs/design/layer2-externalize-jobs.md step 1). It was an owner-only fiber binding; it is the
// product's deterministic state holder (issues an AccessCode, renders the PDF, writes the
// application atomically), so it stays host-owned Go, declared once like every other owner op.
//
// The result is the commit view plus `_embeds` with the final PDF: the MCP face sends it as an
// embedded resource after the text (facadeparity.Invoke), the same [text, PDF] shape the fiber
// returned. The PDF is rendered by gotenberg hitting the admin /print route, pixel-identical to
// the owner's live preview (see docs/design/job-loop.md).

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

const (
	applicationMIMEPDF   = "application/pdf"
	applicationURIScheme = "standmeet://application/"
)

var commitSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"draft_id":{"type":"string","description":"draft id from resume.draft"}
	},
	"required":["draft_id"]
}`)

// ApplicationOps —— applications.commit.
func ApplicationOps(apps *jobsuc.ApplicationsDeps, log *slog.Logger) []fp.Op {
	return []fp.Op{{
		ID: "applications.commit", Kind: fp.Action, Danger: fp.DangerAuthority,
		// MCP only, as the fiber was: the admin composer commits through jobsadmin's
		// /api/admin/applications route, which runs the same CommitApplication.
		Reach:       fp.Only("the panel commits through jobsadmin's applications route", "mcp"),
		InputSchema: commitSchema,
		Description: "Promote a resume draft to a persistent application: atomically " +
			"issues a 180-day AccessCode (10 sessions / 50 turns per member), writes " +
			"the application row, and deletes the draft. Returns application_id, the " +
			"plaintext access_code, the QR URL printed on the resume, and the final " +
			"PDF (base64) ready for Playwright submission.",
		Invoke: commitInvoke(apps, log),
	}}
}

type commitArgsWire struct {
	DraftID string `json:"draft_id"`
}

type embedWire struct {
	URI      string `json:"uri"`
	MIMEType string `json:"mime_type"`
	Blob     []byte `json:"blob"`
}

type commitResult struct {
	committedApplicationViewT

	Embeds []embedWire `json:"_embeds"`
}

func commitInvoke(apps *jobsuc.ApplicationsDeps, log *slog.Logger) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args commitArgsWire
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		if args.DraftID == "" {
			return nil, errors.New("draft_id is required")
		}
		committed, err := jobsuc.CommitApplication(
			ctx, apps, ownerID, args.DraftID, jobsuc.CommitOptions{},
		)
		if err != nil {
			return nil, commitErr(log, err)
		}
		return commitOut(&committed)
	}
}

// commitOut —— the commit view, with the final PDF in `_embeds`.
func commitOut(c *jobsmodel.CommittedApplication) (json.RawMessage, error) {
	out, err := json.Marshal(commitResult{
		committedApplicationViewT: committedApplicationView(c),
		Embeds: []embedWire{{
			URI: applicationURIScheme + c.Application.ID, MIMEType: applicationMIMEPDF, Blob: c.PDF,
		}},
	})
	if err != nil {
		return nil, errors.New("encode view: " + err.Error())
	}
	return out, nil
}

// commitErr —— the sentence the owner's AI client reads.
func commitErr(log *slog.Logger, err error) error {
	switch {
	case errors.Is(err, jobsmodel.ErrResumeDraftNotFound):
		return errors.New("draft not found (expired or wrong owner)")
	case errors.Is(err, owner.ErrOwnerNotFound):
		return errors.New("owner not found")
	}
	log.Error("applications.commit", "err", err)
	return errors.New("applications.commit failed")
}

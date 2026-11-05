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
		"draft_id":{"type":"string","description":"draft id from resume.draft"},
		"accept":{"type":"array","items":{"type":"string"},
			"description":"keys of the draft's check findings the owner approved"}
	},
	"required":["draft_id"]
}`)

// ApplicationOps —— applications.commit + applications.resume_pdf. The repo (GetByID) is passed
// alongside apps (Owners / Codes / Renderer) because resume_pdf re-renders a committed row.
func ApplicationOps(
	apps *jobsuc.ApplicationsDeps, repo *jobsuc.ApplicationRepo, log *slog.Logger,
) []fp.Op {
	return []fp.Op{{
		ID: "applications.commit", Kind: fp.Action, Danger: fp.DangerAuthority,
		// MCP only, as the fiber was: the admin composer commits through jobsadmin's
		// /api/admin/applications route, which runs the same CommitApplication.
		Reach:       fp.Only("the panel commits through jobsadmin's applications route", mcpFace),
		InputSchema: commitSchema,
		Description: "Promote a resume draft to a persistent application: atomically " +
			"issues a 180-day AccessCode (10 sessions / 50 turns per member), writes " +
			"the application row, and deletes the draft. Returns application_id, the " +
			"plaintext access_code, the QR URL printed on the resume, and the final " +
			"PDF (base64) ready for Playwright submission. Refused while the draft has " +
			"check findings " +
			"(from resume.update_draft) not listed in accept.",
		Invoke: commitInvoke(apps, log),
	}, {
		ID: "applications.resume_pdf", Kind: fp.Read,
		// MCP only: the panel downloads through jobsadmin's applications route, which runs the
		// same RenderCommittedPDF.
		Reach:       fp.Only("the panel downloads through jobsadmin's applications route", mcpFace),
		InputSchema: appIDSchema,
		Description: "Re-render a committed application's final résumé PDF on demand, by " +
			"application_id. Returns the PDF (base64) — the same bytes commit printed, with this " +
			"application's own QR code — re-rendered from the stored row. Pure read: no new row, " +
			"no new code, no state change. Fetch a committed application's PDF any time after " +
			"commit without re-rendering locally.",
		Invoke: resumePDFInvoke(apps, repo, log),
	}}
}

var resumePDFURIScheme = applicationURIScheme + "pdf/"

type resumePDFResult struct {
	ApplicationID string      `json:"application_id"`
	Embeds        []embedWire `json:"_embeds"`
}

func resumePDFInvoke(
	apps *jobsuc.ApplicationsDeps, repo *jobsuc.ApplicationRepo, log *slog.Logger,
) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var args struct {
			ApplicationID string `json:"application_id"`
		}
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, errors.New("invalid arguments: " + err.Error())
		}
		if args.ApplicationID == "" {
			return nil, errors.New("application_id is required")
		}
		pdf, err := jobsuc.RenderCommittedPDF(ctx, repo, apps, ownerID, args.ApplicationID)
		if err != nil {
			return nil, resumePDFErr(log, err)
		}
		return json.Marshal(resumePDFResult{
			ApplicationID: args.ApplicationID,
			Embeds: []embedWire{{
				URI:      resumePDFURIScheme + args.ApplicationID,
				MIMEType: applicationMIMEPDF, Blob: pdf,
			}},
		})
	}
}

// resumePDFErr —— the sentence the owner's AI client reads.
func resumePDFErr(log *slog.Logger, err error) error {
	switch {
	case errors.Is(err, jobsmodel.ErrApplicationNotFound):
		return errors.New("application not found (unknown id or wrong owner)")
	case errors.Is(err, owner.ErrPublicURLNotSet):
		return errors.New("set your public URL first (page.set_url): the QR needs it")
	}
	log.Error("applications.resume_pdf", "err", err)
	return errors.New("applications.resume_pdf failed")
}

type commitArgsWire struct {
	DraftID string   `json:"draft_id"`
	Accept  []string `json:"accept"`
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
			ctx, apps, ownerID, args.DraftID, jobsuc.CommitOptions{Accept: args.Accept},
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
	case errors.Is(err, jobsuc.ErrDraftFindings):
		return errors.New(err.Error())
	}
	log.Error("applications.commit", "err", err)
	return errors.New("applications.commit failed")
}

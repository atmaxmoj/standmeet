// applications.go — Phase 3: the owner promotes a preview draft into a persisted
// application via the MCP `applications.commit` tool:
//   1. in one transaction: issue an AccessCode (180d / 10 sessions / 50 turns) + write the
//      application row + delete the draft (ApplicationRepo.Commit wraps the transaction)
//   2. assemble the final QR URL = `<owner.public_url>?code=<plaintext>` — v1 is a single-
//      owner instance, so a visitor landing on the root domain is already this owner; the
//      URL carries no handle.
//   3. hand the injected PDFRenderer the application (resume_content + job_snapshot) +
//      qr_url to render final PDF bytes — v1's implementation is a gotenberg sidecar that
//      drives headless Chromium against the admin /print route, the same React component
//      the owner's live preview uses
//   4. return application + access_code + qr_url + PDF bytes to Claude
//
// L.13 decision: draft.job_snapshot is already the snapshot taken at commit time, so the
// commit path doesn't depend on the jobcache TTL; it's safe to evict right after commit.

package jobsuc

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// PDFRenderer — renders the application's final PDF (QR code included). The usecase
// doesn't care which path the implementation takes (in-process / sidecar / remote
// service), it just calls it once. gotenberg.NoopClient used to be injected at wireup, in
// which case commit fails with gotenberg.ErrNotConfigured — that was expected before
// task 13 was finished.
type PDFRenderer interface {
	RenderApplicationPDF(
		ctx context.Context, app *jobsmodel.Application, qrURL string,
	) ([]byte, error)
}

const (
	// Design doc L: valid for 180d / 10 names (people) / 50 turns per session.
	// "10 sessions" already means "10 people" (member=name=session), so it maps to max_members.
	applicationCodeDays     = 180
	applicationMaxMembers   = int32(10)
	applicationMaxTurns     = int32(50)
	applicationCodeRandLen  = 6 // base32 chars after the "app-" prefix
	applicationCodePrefix   = "app"
	applicationCodeRandSize = 4 // bytes → 6 base32 chars
)

// ApplicationsDeps — applications.* usecase dependencies.
//
// No PublicURL field: each application's public URL is read from owner.PublicURL
// (written into the owners row at claim time, editable in admin). One source of truth, no
// env var, no fallback. Renderer used to be injected at wireup — v1 is a gotenberg client,
// tests use a fake.
type ApplicationsDeps struct {
	Apps   CommitStore
	Owners OwnerLookup
	Roles  *access.RoleRepo
	// Prompts — exists only to attach the builtin `hiring` prompt to auto-issued codes.
	// A narrow interface: look up by name. Centralized hiring context lives here rather
	// than being frozen into the code's text at issue time — the snapshot is taken when
	// the session is granted, so every polish the owner makes afterward still benefits
	// every application code that hasn't been opened yet.
	Prompts PromptLookup
	// CVCheck — asks, at code-issue time, whether the CV note the hiring role grants
	// exists. nil = don't ask (the old wiring path / tests); missing **doesn't block
	// the submission** either, it only adds a line to the receipt.
	CVCheck  CVPresence
	Renderer PDFRenderer
}

// PromptLookup — fetches one prompt's id by name. Narrow, only as much as the job loop needs.
type PromptLookup interface {
	IDByName(ctx context.Context, ownerID, name string) (string, error)
}

// CommitStore —— the application persistence CommitApplication needs (narrow → the render-before-
// persist ordering is unit-testable with a spy that asserts Commit is not reached on render fail).
// *ApplicationRepo satisfies it.
type CommitStore interface {
	GetDraftRenderData(
		ctx context.Context, ownerID, draftID string,
	) (DraftRenderData, error)
	Commit(ctx context.Context, in *CommitInput) (CommitOutput, error)
}

// OwnerLookup — fetches the owner handle used to assemble the QR URL; an interface avoids
// coupling usecases directly to the concrete postgres OwnerRepo (the cmd-layer wireup
// injects the real implementation).
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (owner.Owner, error)
}

// CommitApplication — the main entry point. Returns the structured application + the
// access code issued in the same transaction + the QR URL + the final PDF bytes.
func CommitApplication(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (jobsmodel.CommittedApplication, error) {
	if ownerID == "" || draftID == "" {
		return jobsmodel.CommittedApplication{}, apierr.ErrEmptyField
	}
	return renderThenCommit(ctx, deps, ownerID, draftID)
}

// renderThenCommit —— render the final PDF BEFORE the irreversible commit: all render inputs (draft
// content, a pre-generated code + application id, QR URL) are read/generated without persisting
// anything, so a render failure strands nothing and the owner can retry. Only after the PDF is in
// hand do we commit.
func renderThenCommit(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (jobsmodel.CommittedApplication, error) {
	rp, err := prepareRender(ctx, deps, ownerID, draftID)
	if err != nil {
		return jobsmodel.CommittedApplication{}, err
	}
	pdf, err := deps.Renderer.RenderApplicationPDF(ctx, &rp.renderApp, rp.qrURL)
	if err != nil {
		return jobsmodel.CommittedApplication{}, fmt.Errorf("render final pdf: %w", err)
	}
	out, err := runCommitTx(ctx, deps, ownerID, draftID, &rp)
	if err != nil {
		return jobsmodel.CommittedApplication{}, err
	}
	return jobsmodel.CommittedApplication{
		Application: out.Application,
		AccessCode:  out.AccessCode,
		QRURL:       rp.qrURL,
		PDF:         pdf,
		Warning:     cvWarning(ctx, deps, ownerID),
	}, nil
}

// renderPrep —— everything needed to render the final PDF, produced without persisting anything.
type renderPrep struct {
	qrURL     string
	code      string
	appID     string
	renderApp jobsmodel.Application
}

func prepareRender(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string,
) (renderPrep, error) {
	ownerRow, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return renderPrep{}, fmt.Errorf("get owner: %w", err)
	}
	if ownerRow.PublicURL == "" {
		return renderPrep{}, owner.ErrPublicURLNotSet
	}
	data, err := deps.Apps.GetDraftRenderData(ctx, ownerID, draftID)
	if err != nil {
		return renderPrep{}, fmt.Errorf("get draft render data: %w", err)
	}
	code, err := generateApplicationCode()
	if err != nil {
		return renderPrep{}, err
	}
	appID := uuid.NewString()
	return renderPrep{
		renderApp: jobsmodel.Application{
			ID: appID, ResumeContent: data.Resume, JobSnapshot: data.Job, Template: data.Template,
		},
		qrURL: buildQRURL(ownerRow.PublicURL, code), code: code, appID: appID,
	}, nil
}

func runCommitTx(
	ctx context.Context, deps *ApplicationsDeps, ownerID, draftID string, rp *renderPrep,
) (CommitOutput, error) {
	expires := time.Now().AddDate(0, 0, applicationCodeDays)
	maxMembers := applicationMaxMembers
	maxTurns := applicationMaxTurns
	// This code is printed in the QR on the resume's top-right corner — it's a
	// **targeted invitation**, so it must not be assigned the uninvited-visitor public
	// fallback role. Assigning the wrong role only shows its effect once public narrows
	// to "published only": the recruiter scans in and sees only the public page
	// (downstream of F-D-7).
	//
	// It's assigned `hiring`, not `invited`: a recruiter will always ask about employer,
	// dates and work authorization, and those facts live in subjectivity, not in
	// invited's three globs. Adding subjectivity to invited would hand this PII to
	// **every code the product issues** (gate-approved codes included) — hence a
	// separate role. This role is seeded by this plugin itself (jobs_seed.go), not by
	// the kernel's roles_seed.
	hiring, verr := deps.Roles.GetByName(ctx, ownerID, hiringRoleName)
	if verr != nil {
		return CommitOutput{}, fmt.Errorf("get hiring role: %w", verr)
	}
	in := &CommitInput{
		OwnerID:            ownerID,
		DraftID:            draftID,
		ApplicationID:      rp.appID,
		CodePlaintext:      rp.code,
		CodeLabel:          applicationCodeLabel(&rp.renderApp.JobSnapshot),
		CodePurpose:        "application invitation",
		CodePromptID:       hiringPromptID(ctx, deps, ownerID),
		CodeExpiresAt:      &expires,
		MaxMembers:         &maxMembers,
		MaxTurnsPerSession: &maxTurns,
		AssumedRoleID:      hiring.ID(),
	}
	out, err := deps.Apps.Commit(ctx, in)
	if err != nil {
		if errors.Is(err, jobsmodel.ErrResumeDraftNotFound) {
			return CommitOutput{},
				fmt.Errorf("draft missing: %w", jobsmodel.ErrResumeDraftNotFound)
		}
		return CommitOutput{}, fmt.Errorf("commit application: %w", err)
	}
	return out, nil
}

// hiringRoleName / hiringPromptName — the names of the two builtins this plugin seeds
// itself. seed.go in the same package plants them; this file consumes them — one set of
// constants, shared by both.
const (
	hiringRoleName   = "hiring"
	hiringPromptName = "hiring"
)

// applicationCodeLabel — the tag shown in the sidebar and on the codes panel.
//
// Warning: this used to just be the constant `applicationCodePrefix` — every code issued
// for every application carried the same string, while this field's design intent is to
// "say which slice the visitor is entering." An owner opening the codes panel would see a
// dozen identical tags and couldn't tell which was for which application
// ([[names-that-lie]]). The title and company are right there in job_snapshot — a
// one-line fetch.
func applicationCodeLabel(job *jobsmodel.FetchedJob) string {
	if role := describeRole(job.Title, job.Company); role != "" {
		return applicationCodePrefix + " · " + role
	}
	return applicationCodePrefix
}

// cvGlobSuffix — the address portion of the CV glob in the hiring role's allow list.
//
// It's a **convention name**, not something the product guarantees exists: if the owner
// titles that subjectivity note anything else, this glob simply won't match, and the
// recruiter path silently loses a CV — and what's missing is exactly the employer and
// dates the recruiter is bound to ask about. This mismatch used to be **completely
// silent**.
const cvGlobSuffix = "subjectivity://cv"

// cvWarning — checks once, at code-issue time: the hiring role grants a CV, does that
// note actually exist?
//
// The check happens at **commit**, not at seed: seed runs at startup, when the owner may
// not have written a CV yet, so warning there would just become noise. Commit is the
// moment "this application is about to be sent out" — someone is watching, and it's
// exactly the moment where "the recruiter will ask about my employer and I can't answer"
// would cost something.
//
// It only **says so**, it doesn't block: a CV isn't a precondition for submitting, the
// owner may simply choose not to include one.
func cvWarning(ctx context.Context, deps *ApplicationsDeps, ownerID string) string {
	if deps.CVCheck == nil {
		return ""
	}
	if deps.CVCheck.Exists(ctx, ownerID, cvGlobSuffix) {
		return ""
	}
	return "The `hiring` role grants " + cvGlobSuffix + ", but no such entry exists. " +
		"A recruiter asking about employers, dates or work authorization will be told " +
		"it is not in the notes. Write it with subjectivity_write titled \"cv\", or " +
		"narrow the role in /admin/roles if that is deliberate."
}

// hiringPromptID — the builtin `hiring` prompt's id. Returns nil if it can't be found:
// **doesn't block submission**. The only reason this path can fail is that this instance
// hasn't seeded hiring yet (shouldn't happen), and blocking the owner's resume submission
// for that would punish the user for a bug in the system.
func hiringPromptID(ctx context.Context, deps *ApplicationsDeps, ownerID string) *string {
	if deps.Prompts == nil {
		return nil
	}
	id, err := deps.Prompts.IDByName(ctx, ownerID, hiringPromptName)
	if err != nil || id == "" {
		return nil
	}
	return &id
}

// generateApplicationCode — "app-XXXXXX" lowercase base32 (4 random bytes ≈ 6 chars).
// Character set is only a-z2-7: URL-safe and readable at a glance.
func generateApplicationCode() (string, error) {
	buf := make([]byte, applicationCodeRandSize)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return applicationCodePrefix + "-" + strings.ToLower(enc)[:applicationCodeRandLen], nil
}

func buildQRURL(publicURL, code string) string {
	base := strings.TrimRight(publicURL, "/")
	return fmt.Sprintf("%s/?code=%s", base, url.QueryEscape(code))
}

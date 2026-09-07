// boot_pdf.go — the résumé PDF renderer wiring. Split out of boot_deps.go to hold the 350-line cap.
//
// A3: the résumé PDF renders from the SAME Puck config as the editor (one renderer, no typst).
// gotenberg's Chromium loads the print route, SSRs the Puck <Render>, and prints it.

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/internal/infra/gotenberg"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/printsess"
)

// buildPDFRenderer —— resume PDFs render from the SAME Puck config as the editor (A3: one renderer,
// no typst). gotenberg's Chromium loads the print route (/print/application/<id>), which SSRs the
// Puck <Render> and prints it, so what the owner arranges is exactly what prints. Enabled when
// GOTENBERG_URL + PRINT_BASE_URL are set; else a noop that fails commit loudly (no empty PDF).
//
//nolint:ireturn // composition root deliberately returns interface
func buildPDFRenderer(
	log *slog.Logger, cfg *config.Config, store *printsess.Store,
) jobsuc.PDFRenderer {
	if cfg.GotenbergURL == "" || cfg.PrintBaseURL == "" {
		log.Info("pdf renderer: disabled (set GOTENBERG_URL + PRINT_BASE_URL to enable)")
		return noopPDFRenderer{}
	}
	log.Info("pdf renderer: gotenberg", "endpoint", cfg.GotenbergURL, "print", cfg.PrintBaseURL)
	return gotenbergPDFRenderer{
		client:    gotenberg.New(cfg.GotenbergURL),
		store:     store,
		printBase: cfg.PrintBaseURL,
	}
}

// gotenbergPDFRenderer —— bridges jobsuc.PDFRenderer to the gotenberg sidecar:
//  1. Stash (Application + qrURL) in Redis via printsess.Store → token
//  2. Build print URL: <printBase>/print/application/<id>?t=<token>
//  3. POST it to gotenberg; its Chromium fetches the print URL, which SSRs the Puck <Render>
//     after calling back to /internal/print-session/<token> for the payload (one-shot, TTL 60s)
//  4. PDF bytes stream back through the commit path.
type gotenbergPDFRenderer struct {
	client    gotenberg.Renderer
	store     *printsess.Store
	printBase string
}

func (r gotenbergPDFRenderer) RenderApplicationPDF(
	ctx context.Context, app *jobsmodel.Application, qrURL string,
) ([]byte, error) {
	token, err := r.store.Stash(ctx, &printsess.Payload{
		ApplicationID: app.ID,
		ResumeContent: app.ResumeContent,
		JobSnapshot:   app.JobSnapshot,
		QRURL:         qrURL,
	})
	if err != nil {
		return nil, fmt.Errorf("stash print session: %w", err)
	}
	printURL := r.printBase + "/print/application/" + app.ID + "?t=" + url.QueryEscape(token)
	pdf, rerr := r.client.RenderURL(ctx, printURL)
	if rerr != nil {
		return nil, fmt.Errorf("render application %s: %w", app.ID, rerr)
	}
	return pdf, nil
}

// noopPDFRenderer —— surfaces gotenberg.ErrNotConfigured so commit fails loudly when the env vars
// are missing instead of producing an empty PDF.
type noopPDFRenderer struct{}

func (noopPDFRenderer) RenderApplicationPDF(
	_ context.Context, _ *jobsmodel.Application, _ string,
) ([]byte, error) {
	return nil, gotenberg.ErrNotConfigured
}

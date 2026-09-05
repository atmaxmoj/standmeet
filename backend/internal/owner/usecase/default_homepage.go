// default_homepage.go — installs the default homepage as the reserved `home` microsite at
// claim, PRE-LOADED with the design-system template, so a fresh instance has a homepage ready to
// publish. This is PRODUCTION default-content installation (like seeding the public role at
// claim), NOT a test fixture.
//
// It creates the page and writes the source as a DRAFT; the owner reviews and publishes it
// (build + promote) from /admin/pages, at which point it serves at `/` (routes/public
// serveHomepage). It deliberately does NOT auto-build/promote at claim: that would need an
// ad-hoc timer (which this codebase forbids — periodic work goes through internal/infra/periodic)
// or a build-completion event hook. Making it live automatically at claim is a follow-up; until
// the owner publishes, `/` shows the built-in homepage (the safe fallback).

package usecase

import (
	"context"
	_ "embed"
	"log/slog"
)

//go:embed defaulthomepage/App.tsx
var defaultHomepageApp string

const defaultHomepageTitle = "Homepage"

// InstallDefaultHomepage — create the `home` page and write its source as a draft. Called
// best-effort after claim; on success the owner has a homepage ready to publish.
func InstallDefaultHomepage(
	ctx context.Context, deps MicrositeDeps, ownerID string, log *slog.Logger,
) error {
	if _, err := CreatePage(ctx, deps, &CreatePageInput{
		OwnerID: ownerID, Slug: HomepageSlug, Title: defaultHomepageTitle,
	}); err != nil {
		return err
	}
	if _, err := WriteFile(ctx, deps, &WriteFileInput{
		OwnerID: ownerID, Slug: HomepageSlug, Path: "App.tsx", Content: defaultHomepageApp,
	}); err != nil {
		return err
	}
	log.Info("default homepage installed as a draft (publish from /admin/pages to serve at /)",
		"owner_id", ownerID)
	return nil
}

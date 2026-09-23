// boot_wireup_public.go —— the Deps blocks for the public (visitor-facing) sub-routers.
//
// Split out of boot_wireup.go, which reached its line cap. The seam matches the one in
// boot_http_public.go: the public surface is assembled in one place and mounted in one place.

package main

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
)

func buildPublicDeps(d *deps.Runtime) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor:      newVisitorSessionDeps(d),
		SecureCookie: d.SecureCookie,
		Outbound:     port.OutboundSender(d),
		Owners:       d.OwnerRepo,
		Resolver:     d.ProviderResolver,
		Reports:      d.ChatReportRepo,
		Sessions:     d.VisitorStore,
		Embeds:       d.EmbedRepo,
		EmbedNonce:   port.EmbedNonceStore(d),
		QueryQueue:   d.QueryQueue,
		Corpus:       d.Corpus,
		Subjectivity: corpus.NewSubjectivityCiteResolver(d.SubjectivityRepo),
		Ledger:       conversation.NewWaypointLedger(d.VaultSyncRepo, d.VisitorStore, d.Log),
		Ghosts:       conversation.GhostDeps{Repo: d.GhostRepo},
		PDFRenderer:  d.ReportPDFRenderer,
		AppState:     d.AppStateRepo,
		Usage:        d.InferenceUsageRepo,
		Log:          d.Log,
	}
}

func buildPublicPageDeps(d *deps.Runtime) publicroutes.PageHandlers {
	return publicroutes.PageHandlers{
		Page: owner.PageDeps{Owners: d.OwnerRepo},
		Log:  d.Log,
		TokenIssuer: &setupTokenIssuerAdapter{
			log: d.Log, repo: d.InstanceRepo, holder: d.SetupTokenHolder,
		},
		CaptchaSiteKey: d.CaptchaSiteKey,
		AppVersion:     port.AppVersion(),
		Outbound:       owner.OutboundStatusDeps{Proxy: port.OutboundSender(d)},
	}
}

func buildPublicSEODeps(d *deps.Runtime) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps: owner.SEODeps{
			Owners: d.OwnerRepo, SEO: d.SEORepo,
			Wiki: d.WikiRepo, Output: d.OutputRepo,
			Microsites: d.MicrositeRepo, NoteRefs: d.NoteRefRepo,
			// Assets: the reader resolves standmeet-asset references in the body into URLs.
			Media: &corpus.NoteAssetsDeps{
				Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
				Hero:   d.NoteHeroRepo,
			},
			// Multi-language: identity language + switcher labels (backfilled once on read).
			Vault: d.VaultSyncRepo,
		},
		Sessions: d.VisitorStore,
		Log:      d.Log,
	}
}

// buildAccessRequestNotify — the best-effort owner-notification hook fired after a request is
// stored. The owner domain owns the content; the outbound channel (with its email-bomb burst cap)
// is wired in by the composition root — access only calls back.
func buildAccessRequestNotify(d *deps.Runtime) func(context.Context, string, access.Request) {
	notify := owner.NotifyNewRequestDeps{
		Owners: d.OwnerRepo, Proxy: port.AccessRequestNotifySender(d), Log: d.Log,
	}
	return func(ctx context.Context, ownerID string, req access.Request) {
		owner.NotifyOwnerOfNewRequest(ctx, notify, ownerID, &req)
	}
}

func buildPublicAccessRequestsDeps(d *deps.Runtime) publicroutes.AccessRequestsHandlers {
	return publicroutes.AccessRequestsHandlers{
		Reqs: access.RequestsDeps{
			Repo:   d.AccessRequestRepo,
			Owners: port.NewSoleOwnerLookup(d),
			Notify: buildAccessRequestNotify(d),
		},
		Log: d.Log,
	}
}

func buildPublicPasswordResetDeps(d *deps.Runtime) publicroutes.PasswordResetHandlers {
	return publicroutes.PasswordResetHandlers{
		Deps: owner.PasswordResetDeps{Owners: d.OwnerRepo},
		Log:  d.Log,
	}
}

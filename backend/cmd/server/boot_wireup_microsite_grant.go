// boot_wireup_microsite_grant.go —— who opens a page closed to visitors without a code, and the
// touch a code holder's visit gives the page's ephemeral clock.

package main

import (
	"context"
	"net/http"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// micrositeGrant —— who opens a page closed to visitors without a code: the owner (a live owner
// session) or a visitor whose session's code is bound to the page. Any lookup error → closed.
func micrositeGrant(d *deps.Runtime) func(*http.Request, string, string) bool {
	pages := owner.MicrositeDeps{Pages: d.MicrositeRepo, Builds: d.MicrositeBuildRepo}
	return func(r *http.Request, visitorToken, pageID string) bool {
		return ownerSignedIn(r, d) ||
			visitorCodeOpens(r.Context(), d, pages, visitorToken, pageID)
	}
}

func ownerSignedIn(r *http.Request, d *deps.Runtime) bool {
	c, err := r.Cookie(middleware.SessionCookieName)
	if err != nil || c.Value == "" {
		return false
	}
	_, err = d.SessionStore.Get(r.Context(), c.Value)
	return err == nil
}

func visitorCodeOpens(
	ctx context.Context, d *deps.Runtime, pages owner.MicrositeDeps, token, pageID string,
) bool {
	codeID := visitorCode(ctx, d, token)
	if codeID == "" {
		return false
	}
	ok, err := owner.CodeOpensPage(ctx, pages, codeID, pageID)
	if err != nil || !ok {
		return false
	}
	// A code holder on the page — opening it, or a chat turn on it (micrositeText asks the same
	// grant) — renews the page's ephemeral bundle. ponytail: one UPDATE per served asset; batch
	// per page load if it ever shows up in the profile.
	owner.TouchPage(ctx, pages.Pages, pageID)
	return true
}

// visitorCode —— the code a visitor session was opened with; "" for none.
func visitorCode(ctx context.Context, d *deps.Runtime, token string) string {
	if token == "" {
		return ""
	}
	sess, err := d.VisitorStore.Get(ctx, token)
	if err != nil {
		return ""
	}
	return sess.CodeID
}

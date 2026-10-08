// microsite_text.go — a live microsite read as text, for the agent that chats on it.
//
// A microsite is prerendered at build time (builder/template/prerender.mjs), so its
// dist/index.html already carries the page's prose. The agent reads that text — the owner's
// published build, the same one /p/<slug> serves — never text a browser sent.

package usecase

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atmaxmoj/standmeet/internal/infra/plaintext"
	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

// pageTextCap — the most runes of page text a chat turn carries. A microsite is a page, not a
// book; past this the text is cut with a mark.
const pageTextCap = 6000

// MicrositeTextInput —— which page's text, read from where, for whom.
type MicrositeTextInput struct {
	Granted    func(pageID string) bool
	BuildsRoot string
	Slug       string
}

// LiveMicrositeText — the visible text of slug's live build, capped, for a caller that may open
// the page: granted(pageID) is the same grant /p/<slug> serves by (owner, or a code bound to the
// page). A page closed to this caller, or not live, has no text (the resolve error) — the slug
// comes from the browser, so naming a closed page must not read it to the model. The prerendered
// file links its scripts and styles (vite output), so stripping the tags leaves the prose.
func LiveMicrositeText(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, in *MicrositeTextInput,
) (string, error) {
	live, err := ResolveOpenBuild(ctx, deps, owners, in.Slug, in.Granted)
	if err != nil {
		return "", err
	}
	fp := filepath.Join(in.BuildsRoot, live.Build.PageID, live.Build.ID, "dist", "index.html")
	body, rerr := os.ReadFile(filepath.Clean(fp))
	if rerr != nil {
		return "", fmt.Errorf("read prerendered page: %w", rerr)
	}
	return textcut.RunesMark(plaintext.FromHTML(string(body)), pageTextCap), nil
}

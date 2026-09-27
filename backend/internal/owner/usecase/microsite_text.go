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

// LiveMicrositeText — the visible text of slug's live build, capped. A page that is not live has
// no text (the resolve error). The prerendered file links its scripts and styles (vite output),
// so stripping the tags leaves the prose. Page and build ids come from the database.
func LiveMicrositeText(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, buildsRoot, slug string,
) (string, error) {
	live, err := ResolveLiveBuild(ctx, deps, owners, slug)
	if err != nil {
		return "", err
	}
	fp := filepath.Join(buildsRoot, live.Build.PageID, live.Build.ID, "dist", "index.html")
	body, rerr := os.ReadFile(filepath.Clean(fp))
	if rerr != nil {
		return "", fmt.Errorf("read prerendered page: %w", rerr)
	}
	return textcut.RunesMark(plaintext.FromHTML(string(body)), pageTextCap), nil
}

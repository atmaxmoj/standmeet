// microsite_draft.go — reading a page's current draft source files, so the admin editor can
// open an existing page (the mini-IDE at /admin/edit/<slug>). Split from microsite.go to keep
// that file under the max-lines gate.

package usecase

import "context"

// GetDraftFiles — the current draft's source files (path → content), so the editor can load an
// existing page's files. Empty map for a page with no build yet.
func GetDraftFiles(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (map[string]string, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return nil, err
	}
	return loadDraftFiles(ctx, deps, page.ID)
}

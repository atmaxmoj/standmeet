package admin

import "context"

// installHomepageForOwner installs the default homepage as the `home` microsite after claim.
// Best-effort: a nil hook (old assembly / tests) or a failure only logs; the built-in homepage
// keeps serving. Split out of claim.go to keep that file under the max-lines cap.
func (h *Handlers) installHomepageForOwner(ctx context.Context, ownerID string) {
	if h.InstallHomepage == nil {
		return
	}
	if err := h.InstallHomepage(ctx, ownerID); err != nil {
		h.Log.Error("install default homepage after claim", "owner_id", ownerID, "err", err)
	}
}
